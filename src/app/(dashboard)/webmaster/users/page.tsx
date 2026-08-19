"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { KeyRound, Copy } from "lucide-react";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

type UserRow = Record<string, unknown> & FMSUser & { isActive?: boolean };

const MIN_PASSWORD_LENGTH = 6; // Firebase Auth's own minimum

export default function WebmasterUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const users = await fetch("/api/college/users?includeAll=true").then((r) => r.json() as Promise<{ users: UserRow[] }>).then((d) => d.users ?? []);
      setUsers(users);
    } catch {
      toast({ variant: "destructive", title: "Failed to load accounts" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openResetDialog(user: UserRow) {
    setPasswordInput("");
    setResetTarget(user);
  }

  async function handleReset() {
    if (!resetTarget) return;
    if (passwordInput.length < MIN_PASSWORD_LENGTH) {
      toast({ variant: "destructive", title: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    setIsResetting(true);
    try {
      const res = await fetch("/api/college/webmaster/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: resetTarget.uid, password: passwordInput }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
      toast({ variant: "success", title: "Password reset", description: `Share the new password with ${resetTarget.name} securely.` });
      setResetTarget(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to reset password", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsResetting(false);
    }
  }

  const columns: Column<UserRow>[] = [
    { key: "name", header: "Name", render: (u) => <span className="font-medium">{u.name}</span> },
    { key: "role", header: "Role", render: (u) => <Badge variant="outline">{ROLE_LABELS[u.role] ?? u.role}</Badge> },
    { key: "email", header: "Email", render: (u) => u.email, hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <Badge variant={u.isActive === false ? "secondary" : "default"}>
          {u.isActive === false ? "Inactive" : "Active"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (u) => (
        <Button size="sm" variant="outline" onClick={() => openResetDialog(u)}>
          <KeyRound className="h-3.5 w-3.5 mr-1.5" />
          Reset Password
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="All Accounts" description="Every login in this college - reset a password if someone is locked out" />

      <DataTable
        data={users}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by name or email..."
        searchKeys={["name", "email"]}
        emptyTitle="No accounts found"
        keyExtractor={(u) => u.uid}
      />

      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set the new password for <strong>{resetTarget ? (ROLE_LABELS[resetTarget.role] ?? resetTarget.role) : ""}</strong> — {resetTarget?.name} ({resetTarget?.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Password</Label>
            <div className="flex gap-2">
              <Input
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                className="font-mono"
                disabled={isResetting}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Copy password"
                disabled={!passwordInput || isResetting}
                onClick={() => { void navigator.clipboard.writeText(passwordInput); toast({ variant: "success", title: "Password copied" }); }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={isResetting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleReset()} loading={isResetting}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
