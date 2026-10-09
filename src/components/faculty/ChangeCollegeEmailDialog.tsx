"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { EMAIL_REGEX } from "@/lib/validations";

interface Props {
  faculty: { id: string; employeeId: string; name: string } | null;
  onClose: () => void;
  onChanged: (facultyId: string, newEmail: string) => void;
}

interface Check {
  recordEmail: string;
  loginEmail: string | null;
  inSync: boolean;
  hasLogin: boolean;
  available: boolean | null;
  reason: string;
}

// College Office > Faculty > Change College Email. The Employee ID is shown read-only and is what the server matches the
// request on; the college email is the faculty member's login, so the server changes every copy together and signs them
// out on all devices (lib/faculty/changeCollegeEmail.ts).
export function ChangeCollegeEmailDialog({ faculty, onClose, onChanged }: Props) {
  return (
    <Dialog open={!!faculty} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* keyed by person: opening another faculty member starts from a clean form */}
      {faculty && <EmailForm key={faculty.id} faculty={faculty} onClose={onClose} onChanged={onChanged} />}
    </Dialog>
  );
}

function EmailForm({ faculty, onClose, onChanged }: { faculty: NonNullable<Props["faculty"]>; onClose: () => void; onChanged: Props["onChanged"] }) {
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  // Current emails (and sync state) as soon as the dialog opens, then a debounced availability check as they type.
  useEffect(() => {
    const mine = ++seq.current;
    const typed = email.trim().toLowerCase();
    const handle = window.setTimeout(async () => {
      try {
        const q = typed && EMAIL_REGEX.test(typed) ? `?email=${encodeURIComponent(typed)}` : "";
        const res = await fetch(`/api/college/faculty/${faculty.id}/college-email/check${q}`, { cache: "no-store" });
        const data = (await res.json()) as Check & { error?: string };
        if (mine === seq.current) setCheck(res.ok ? data : null);
      } catch { /* the save re-checks everything */ }
    }, typed ? 400 : 0);
    return () => window.clearTimeout(handle);
  }, [faculty.id, email]);

  async function save() {
    const next = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(next)) { setError("Enter a valid email address"); return; }
    if (next !== confirm.trim().toLowerCase()) { setError("The two email addresses don't match"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/college/faculty/${faculty.id}/college-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: faculty.employeeId, newEmail: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to change the college email"); return; }
      toast({ variant: "success", title: "College email changed", description: `${faculty.name} has been signed out on all devices and can sign in again with their Employee ID or ${next}.` });
      onChanged(faculty.id, next);
      onClose();
    } catch {
      setError("Network error - please try again");
    } finally {
      setSaving(false);
    }
  }

  const blocked = !!check && !check.inSync;
  const typedOk = EMAIL_REGEX.test(email.trim().toLowerCase());
  const canSave = !saving && !blocked && typedOk && email.trim().toLowerCase() === confirm.trim().toLowerCase() && check?.available !== false;

  return (
    <>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change College Email</DialogTitle>
          <DialogDescription>
            This is the email {faculty.name} signs in with. The Employee ID and password stay the same.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Employee ID</Label>
              <Input value={faculty.employeeId} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>Current login email</Label>
              <Input value={check ? (check.loginEmail ?? check.recordEmail) : "Loading…"} disabled readOnly />
            </div>
          </div>

          {blocked && check && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Their login email ({check.loginEmail ?? "none"}) is different from the college email on their record ({check.recordEmail || "none"}).
              It needs a manual review before it can be changed here.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="new-college-email">New college email</Label>
            <Input id="new-college-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="name@college.edu" autoComplete="off" disabled={blocked} />
            {typedOk && check?.available === true && <p className="text-xs text-emerald-600">This address is available</p>}
            {typedOk && check?.available === false && <p className="text-xs text-destructive">{check.reason}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-college-email">Confirm new college email</Label>
            <Input id="confirm-college-email" type="email" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(""); }} autoComplete="off" disabled={blocked} />
          </div>

          <p className="text-xs text-muted-foreground">
            The old email stops working at once, and {faculty.name} will be signed out on all devices. They can sign in again with their Employee ID
            and existing password, or with the new email and the same password. They get an in-app notification (no email is sent).
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!canSave}>Change College Email</Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
