"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { KeyRound } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { changePasswordSchema, type ChangePasswordFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  "auth/wrong-password": "Current password is incorrect.",
  "auth/invalid-credential": "Current password is incorrect.",
  "auth/weak-password": "New password is too weak - use at least 8 characters.",
  "auth/requires-recent-login": "Please log out and log back in, then try again.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection.",
};

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  });

  const onSubmit = async (data: ChangePasswordFormData) => {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      toast({ variant: "destructive", title: "No active session", description: "Please log in again." });
      return;
    }
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, data.currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, data.newPassword);

      toast({ variant: "success", title: "Password changed" });
      reset();
      setOpen(false);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      toast({
        variant: "destructive",
        title: "Failed to change password",
        description: FIREBASE_ERROR_MESSAGES[code] ?? "Please try again.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <KeyRound className="mr-2 h-4 w-4" />Change Password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
        </DialogHeader>
        <form
          // See CreateHodDialog.tsx - DialogContent renders through a Portal,
          // but React's synthetic "submit" event still bubbles through the
          // component tree, so without this it would also submit any
          // page-level <form> this dialog happens to be rendered inside.
          onSubmit={(e) => {
            e.stopPropagation();
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password *</Label>
            <Input id="current-password" type="password" autoComplete="current-password" {...register("currentPassword")} />
            {errors.currentPassword && <p className="text-sm text-destructive">{errors.currentPassword.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password *</Label>
            <Input id="new-password" type="password" autoComplete="new-password" placeholder="Min 8 characters" {...register("newPassword")} />
            {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password *</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" {...register("confirmPassword")} />
            {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Change Password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
