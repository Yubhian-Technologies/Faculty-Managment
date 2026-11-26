"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Login > Forgot Password: the person types what they sign in with (email, Employee ID or Regd. No); the server
// (api/auth/forgot-password) emails a reset link - students get it at the email on their student record. The same
// answer is shown whether or not an account matched.

export function ForgotPasswordDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [identifier, setIdentifier] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) { setError("Enter your email, Employee ID or Regd. No."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: identifier.trim() }) });
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to send the reset link. Try again.");
      setSent(d.message ?? "If your account is found, a link to change your password has been sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send the reset link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Forgot Password</DialogTitle>
          <DialogDescription>Enter what you sign in with. We email you a link to change your password.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-start gap-2"><MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />{sent}</p>
            <p className="text-muted-foreground">Open the link in the email to set your new password. The link works once and expires in about an hour.</p>
            <p className="text-muted-foreground">Did not get the email? Check your spam folder. If it is not there, contact your college administrator.</p>
            <DialogFooter><Button onClick={onClose}>Back to Sign In</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="fp-identifier">Email, Employee ID or Regd. No</Label>
              <Input id="fp-identifier" value={identifier} autoFocus autoComplete="username" onChange={(e) => setIdentifier(e.target.value)} />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy}>Send Reset Link</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
