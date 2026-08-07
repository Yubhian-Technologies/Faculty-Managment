"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { UsersRound, Plus, Mail, Phone, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
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

export default function PrincipalStaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingUid, setTogglingUid] = useState<string | null>(null);

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

  // Group by role for a scannable layout — order roughly follows seniority/function.
  const ROLE_ORDER: UserRole[] = ["VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE", "COLLEGE_STAFF", "WEBMASTER", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL"];
  // Must match the roles PRINCIPAL/VICE_PRINCIPAL can edit in /api/college/users/[uid] (loadTargetInScope).
  const EDITABLE_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "PANEL_MEMBER"];
  const grouped = ROLE_ORDER
    .map((role) => ({ role, users: staff.filter((u) => u.role === role) }))
    .filter((g) => g.users.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Manage non-teaching and departmental leadership accounts for your college"
        actions={
          <Button asChild>
            <Link href="/principal/staff/new"><Plus className="h-4 w-4 mr-2" />Add Staff</Link>
          </Button>
        }
      />

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
                          {g.role === "HOD" && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Department</th>}
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
                            {g.role === "HOD" && (
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {u.department || "—"}
                                  {parentDeptName(u.department) && (
                                    <Badge variant="secondary" className="text-xs">Sub-department of {parentDeptName(u.department)}</Badge>
                                  )}
                                </div>
                              </td>
                            )}
                            {g.role === "COLLEGE_STAFF" && <td className="px-4 py-2.5">{u.designation || "—"}</td>}
                            <td className="px-4 py-2.5">
                              <Badge variant={u.isActive === false ? "secondary" : "default"} className="text-xs">
                                {u.isActive === false ? "Inactive" : "Active"}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {EDITABLE_ROLES.includes(u.role) && (
                                  <Button size="sm" variant="ghost" asChild>
                                    <Link href={`/principal/staff/${u.uid}/edit`}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={togglingUid === u.uid}
                                  onClick={() => void toggleActive(u)}
                                >
                                  {u.isActive === false ? "Activate" : "Deactivate"}
                                </Button>
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
    </div>
  );
}
