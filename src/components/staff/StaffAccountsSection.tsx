"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { UsersRound, Plus, Mail, Phone, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

type StaffUser = {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
  designation?: string;
  phone?: string;
  isActive?: boolean;
};

/** Principal / VP login accounts for the college (College Office, HOD, ...): view, add, deactivate, delete. */
export function StaffAccountsSection() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingUid, setTogglingUid] = useState<string | null>(null);
  // Both destructive actions are confirmed rather than acting on the click.
  // Deactivating locks someone out of the system; deleting cannot be undone at
  // all. Activating is neither, so it stays a single click.
  const [deactivateTarget, setDeactivateTarget] = useState<StaffUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [staffRes, deptsRes] = await Promise.all([
        fetch("/api/college/users"),
        fetch("/api/college/departments"),
      ]);
      const json = await staffRes.json() as { users: StaffUser[] };
      const deptsJson = await deptsRes.json() as { departments: Department[] };
      setStaff(json.users ?? []);
      setDepartments(deptsJson.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load staff" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function parentDeptName(deptName: string | undefined): string | null {
    const dept = departments.find((d) => d.name === deptName);
    if (!dept?.parentDepartmentId) return null;
    return departments.find((d) => d.id === dept.parentDepartmentId)?.name ?? null;
  }

  async function toggleActive(u: StaffUser) {
    setTogglingUid(u.uid);
    setDeactivateTarget(null);
    try {
      const res = await fetch(`/api/college/users/${u.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to update" });
        return;
      }
      toast({ variant: "success", title: `${u.name} ${u.isActive ? "deactivated" : "activated"}` });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setTogglingUid(null);
    }
  }

  async function handleDelete() {
    const u = deleteTarget;
    if (!u) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/users/${u.uid}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        // The server refuses while the person still holds a role or heads a
        // department, and says which - worth showing in full rather than a
        // generic failure.
        toast({ variant: "destructive", title: json.error ?? "Failed to delete" });
        return;
      }
      toast({ variant: "success", title: `${u.name} deleted` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  // Group by role for a scannable layout — order roughly follows seniority/function.
  // DIRECTOR is deliberately excluded: it's Super-Admin-provisioned college
  // leadership, not something Principal can view/edit/deactivate/delete (the
  // API's loadTargetInScope 403s on every action for it - see
  // MANAGEABLE_STAFF_ROLES in types/core.ts), so listing it here only produced
  // dead View/Deactivate/Delete buttons.
  const ROLE_ORDER: UserRole[] = ["VICE_PRINCIPAL", "COLLEGE_ADMIN", "HOD", "DEPARTMENT_OFFICE", "COLLEGE_OFFICE", "COLLEGE_ACCOUNTS", "COLLEGE_STAFF", "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "WEBMASTER", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL"];
  const grouped = ROLE_ORDER
    .map((role) => ({ role, users: staff.filter((u) => u.role === role) }))
    .filter((g) => g.users.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-lg">Staff Accounts</h2>
          <p className="text-sm text-muted-foreground">Non-teaching and departmental leadership accounts for your college</p>
        </div>
        <Button asChild>
          <Link href="/principal/staff/new"><Plus className="h-4 w-4 mr-2" />Add Staff</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : staff.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="No staff accounts yet"
              description="Add a College Office, HOD, or other staff account to get started."
              icon={<UsersRound className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.role}>
              <h2 className="font-semibold text-base mb-3">
                {ROLE_LABELS[g.role]} <span className="text-sm font-normal text-muted-foreground">({g.users.length})</span>
              </h2>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Contact</th>
                          {(g.role === "HOD" || g.role === "DEPARTMENT_OFFICE") && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Department</th>}
                          {g.role === "COLLEGE_STAFF" && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Designation</th>}
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {g.users.map((u) => (
                          <tr key={u.uid}>
                            <td className="px-4 py-2.5 font-medium">{u.name}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{u.email}</div>
                              {u.phone && <div className="flex items-center gap-1.5 mt-0.5"><Phone className="h-3.5 w-3.5" />{u.phone}</div>}
                            </td>
                            {/* A Department Office head is defined by which
                                department they run, same as an HOD - so the
                                column is shown for both. */}
                            {(g.role === "HOD" || g.role === "DEPARTMENT_OFFICE") && (
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {u.department || "-"}
                                  {parentDeptName(u.department) && (
                                    <Badge variant="secondary" className="text-xs">Sub-department of {parentDeptName(u.department)}</Badge>
                                  )}
                                </div>
                              </td>
                            )}
                            {g.role === "COLLEGE_STAFF" && <td className="px-4 py-2.5">{u.designation || "-"}</td>}
                            <td className="px-4 py-2.5">
                              <Badge variant={u.isActive === false ? "secondary" : "default"} className="text-xs">
                                {u.isActive === false ? "Inactive" : "Active"}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" asChild>
                                  <Link href={`/principal/staff/${u.uid}`}><Eye className="h-3.5 w-3.5 mr-1" />View</Link>
                                </Button>
                                {/* The College Office login is the college's own admin account: the Principal views it but cannot deactivate or delete it from here. */}
                                {g.role !== "COLLEGE_OFFICE" && g.role !== "COLLEGE_ADMIN" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      loading={togglingUid === u.uid}
                                      onClick={() => (u.isActive === false ? void toggleActive(u) : setDeactivateTarget(u))}
                                    >
                                      {u.isActive === false ? "Activate" : "Deactivate"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setDeleteTarget(u)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}
        title={`Deactivate ${deactivateTarget?.name ?? "this account"}?`}
        description="They lose access immediately and cannot sign in. Their records are kept, and you can activate them again at any time."
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={() => { if (deactivateTarget) void toggleActive(deactivateTarget); }}
        loading={togglingUid === deactivateTarget?.uid}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name ?? "this account"}?`}
        description="This removes their login permanently and cannot be undone. Anything they approved or recorded stays. To take away access but keep the account, use Deactivate instead."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
