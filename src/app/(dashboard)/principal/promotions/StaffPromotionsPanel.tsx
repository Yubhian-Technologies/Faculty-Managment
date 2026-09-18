"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, UserCog } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { MANAGEABLE_STAFF_ROLES, ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

interface StaffUser {
  uid: string;
  name?: string;
  role: UserRole;
  department?: string;
}

// Promotes an existing staff member into a new role on their SAME account -
// their login (personal email), Leave history, personal details, and any
// Teaching Assignments all already resolve by uid/facultyId, never by role
// (see PATCH /api/college/users/[uid]), so nothing needs to be migrated here.
// Any role to any role, no fixed ladder.
export function StaffPromotionsPanel() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedUid, setSelectedUid] = useState("");
  const [newRole, setNewRole] = useState<UserRole | "">("");
  const [newDepartment, setNewDepartment] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      const [usersRes, deptsRes] = await Promise.all([
        fetch("/api/college/users"),
        fetch("/api/college/departments"),
      ]);
      const usersData = await usersRes.json() as { users?: StaffUser[] };
      const deptsData = await deptsRes.json() as { departments?: Department[] };
      setUsers((usersData.users ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
      setDepartments(deptsData.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load staff" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Wrapped so the setState calls inside load() aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, []);

  const selectedUser = useMemo(() => users.find((u) => u.uid === selectedUid) ?? null, [users, selectedUid]);

  function selectPerson(uid: string) {
    setSelectedUid(uid);
    setNewRole("");
    setNewDepartment("");
  }

  function selectNewRole(role: UserRole) {
    setNewRole(role);
    // Pre-fill with whatever department they're already in, if any - only
    // relevant once they're an HOD, but harmless to carry over either way.
    setNewDepartment(role === "HOD" ? (selectedUser?.department ?? "") : "");
  }

  async function handlePromote() {
    if (!selectedUser || !newRole) return;
    if (newRole === "HOD" && !newDepartment) {
      toast({ variant: "destructive", title: "Select a department for the new HOD" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/users/${selectedUser.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: newRole,
          ...(newRole === "HOD" ? { department: newDepartment } : {}),
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to change role");
      toast({ variant: "success", title: `${selectedUser.name ?? "Staff member"} is now ${ROLE_LABELS[newRole]}` });
      setSelectedUid("");
      setNewRole("");
      setNewDepartment("");
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to change role" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Promotion"
        description="Move a staff member into a new role on their same account - their login, leave history, personal details, and any teaching assignments carry over automatically"
      />

      <Card>
        <CardContent className="p-5 space-y-4">
          {isLoading ? (
            <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
                <div className="space-y-2">
                  <Label>Staff Member</Label>
                  <Select value={selectedUid} onValueChange={selectPerson}>
                    <SelectTrigger><SelectValue placeholder="Select a staff member" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.uid} value={u.uid}>
                          {u.name ?? "Unnamed"} — {ROLE_LABELS[u.role] ?? u.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground sm:pb-2">
                  <span>{selectedUser ? ROLE_LABELS[selectedUser.role] ?? selectedUser.role : "—"}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </div>

                <div className="space-y-2">
                  <Label>New Role</Label>
                  <Select value={newRole} onValueChange={(v) => selectNewRole(v as UserRole)} disabled={!selectedUser}>
                    <SelectTrigger><SelectValue placeholder="Select new role" /></SelectTrigger>
                    <SelectContent>
                      {MANAGEABLE_STAFF_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {newRole === "HOD" && (
                <div className="space-y-2 max-w-sm">
                  <Label>Department</Label>
                  <Select value={newDepartment} onValueChange={setNewDepartment}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => void handlePromote()}
                  loading={isSaving}
                  disabled={!selectedUser || !newRole || newRole === selectedUser?.role}
                >
                  <UserCog className="h-4 w-4 mr-2" />
                  Change Role
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
