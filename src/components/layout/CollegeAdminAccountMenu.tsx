"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { Settings } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  "auth/wrong-password": "Current password is incorrect.",
  "auth/invalid-credential": "Current password is incorrect.",
  "auth/weak-password": "New password is too weak - use at least 8 characters.",
  "auth/requires-recent-login": "Please log out and log back in, then try again.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection.",
};

// College Admin has no "My Profile" page (see navConfig.ts's My Profile
// entry) - it's a role-login, not one continuous employee: its actual holder
// can change over time by handing over the credentials, so there's no fixed
// person's HR record to show. This is the one place its Name/Phone (for
// whoever currently holds it) and password live instead, off the account row
// every sidebar/drawer already renders.
export function CollegeAdminAccountMenu({
  uid, name: initialName, phone: initialPhone, fullWidth,
}: { uid: string; name: string; phone?: string; fullWidth?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const detailsDirty = name.trim() !== initialName || phone.trim() !== (initialPhone ?? "");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  async function saveDetails() {
    if (!name.trim()) { toast({ variant: "destructive", title: "Name can't be empty" }); return; }
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/college/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: "Failed to save", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Saved" });
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingDetails(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) { toast({ variant: "destructive", title: "New password must be at least 8 characters" }); return; }
    if (newPassword !== confirmPassword) { toast({ variant: "destructive", title: "Passwords don't match" }); return; }
    const currentUser = auth.currentUser;
    if (!currentUser?.email) { toast({ variant: "destructive", title: "No active session", description: "Please log in again." }); return; }
    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      toast({ variant: "success", title: "Password changed" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      toast({ variant: "destructive", title: "Failed to change password", description: FIREBASE_ERROR_MESSAGES[code] ?? "Please try again." });
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <>
      {fullWidth ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full px-2 py-2 rounded-lg hover:bg-muted"
        >
          <Settings className="h-4 w-4" />
          Account settings
        </button>
      ) : (
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Account settings" onClick={() => setOpen(true)}>
          <Settings className="h-4 w-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Account settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                This is a role login, not tied to one fixed person - update these whenever it changes hands.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <Button size="sm" onClick={() => void saveDetails()} loading={savingDetails} disabled={!detailsDirty}>Save</Button>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <Label className="text-sm font-medium">Change password</Label>
              <div className="space-y-2">
                <Input type="password" autoComplete="current-password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                <Input type="password" autoComplete="new-password" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <Input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <Button size="sm" onClick={() => void changePassword()} loading={changingPassword} disabled={!currentPassword || !newPassword || !confirmPassword}>
                Change Password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
