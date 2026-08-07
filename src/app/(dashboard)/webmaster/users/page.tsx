"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { KeyRound } from "lucide-react";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

type UserRow = Record<string, unknown> & FMSUser & { isActive?: boolean };

export default function WebmasterUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<{ name: string; password: string } | null>(null);

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

  async function handleReset() {
    if (!resetTarget) return;
    setIsResetting(true);
    try {
      const res = await fetch("/api/college/webmaster/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: resetTarget.uid }),
      });
      const data = await res.json() as { ok?: boolean; generatedPassword?: string; error?: string };
      if (!res.ok || !data.generatedPassword) throw new Error(data.error ?? "Failed");
      setRevealedPassword({ name: resetTarget.name, password: data.generatedPassword });
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
        <Button size="sm" variant="outline" onClick={() => setResetTarget(u)}>
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
            <DialogTitle>Reset this account&apos;s password?</DialogTitle>
            <DialogDescription>
              You are resetting the password for <strong>{resetTarget ? (ROLE_LABELS[resetTarget.role] ?? resetTarget.role) : ""}</strong> — {resetTarget?.name} ({resetTarget?.email}).
              A new password will be generated and shown once - share it with them securely.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={isResetting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleReset()} loading={isResetting}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedPassword} onOpenChange={(o) => { if (!o) setRevealedPassword(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Password Reset</DialogTitle>
            <DialogDescription>
              A new password was generated for <strong>{revealedPassword?.name}</strong>. Share this temporary password with them securely - it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-sm text-center select-all">
            {revealedPassword?.password}
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
