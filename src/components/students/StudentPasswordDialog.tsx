"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STUDENT_PASSWORD_MIN_LENGTH, studentPasswordError } from "@/lib/students/passwordPolicy";

// The College Office types the password a student's login is created (or reset)
// with - the system never invents one. It is sent straight to the server, which
// hands it to Firebase Auth; it is not stored, shown again or emailed. Students
// sign in with their Roll Number and this password and can change it themselves.
export function StudentPasswordDialog({
  open,
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  onClose: () => void;
  /** Resolve with an error message to keep the dialog open, or null when it worked. */
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setPassword("");
    setError("");
    setShow(false);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = studentPasswordError(password);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const failure = await onSubmit(password);
      if (failure) setError(failure);
      else close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) close(); }}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="student-login-password">Password</Label>
            <div className="relative">
              <Input
                id="student-login-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder={`At least ${STUDENT_PASSWORD_MIN_LENGTH} characters`}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              This is not saved anywhere readable - note it down to give to the student. They can change it after signing in.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Working..." : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
