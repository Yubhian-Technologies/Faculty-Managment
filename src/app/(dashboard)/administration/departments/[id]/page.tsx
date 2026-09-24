"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UserCircle, Mail, Phone, Users, ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { formatDate } from "@/lib/utils";
import { staffCoversLocationDept } from "@/lib/location/staffDepartments";
import { ROLE_LABELS } from "@/types";
import type { LocationDepartment, FMSUser } from "@/types";

// Read-only "who's assigned here" view - the Edit page (its own route,
// .../edit) stays just the rename/activate form. Staff coverage is read via
// staffCoversLocationDept (single source of truth shared with the Add/Edit
// Staff forms' own department pickers) rather than re-checking
// locationDeptId/department here directly, so an HR Admin/Admin Office/
// Accounts member assigned via "All Departments" or a multi-department pick
// shows up here too, not just a Dept Head's single-department match.
export default function LocationDeptDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const user = useAuthStore((s) => s.user);
  const locationId = user?.locationId ?? "";

  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState<LocationDepartment | null>(null);
  const [staff, setStaff] = useState<FMSUser[]>([]);

  useEffect(() => {
    if (!locationId) return;
    Promise.all([
      fetch(`/api/location/departments?locationId=${locationId}`)
        .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
        .then((d) => (d.departments ?? []).find((dep) => dep.id === id) ?? null),
      fetch(`/api/location/users?locationId=${locationId}`)
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => d.users ?? []),
    ])
      .then(([foundDept, users]) => {
        if (!foundDept) {
          toast({ variant: "destructive", title: "Department not found" });
          router.push("/administration/departments");
          return;
        }
        setDept(foundDept);
        setStaff(users.filter((u) => staffCoversLocationDept(u, id)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load department" }))
      .finally(() => setLoading(false));
  }, [id, locationId, router]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department" description="Loading…" />
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }
  if (!dept) return null;

  const head = dept.deptHeadUid ? staff.find((u) => u.uid === dept.deptHeadUid) : undefined;
  const otherMembers = staff.filter((u) => u.uid !== dept.deptHeadUid);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/administration/departments">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Departments
        </Link>
      </Button>

      <PageHeader
        title={dept.name}
        description="Department overview"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={dept.isActive ? "default" : "secondary"}>{dept.isActive ? "Active" : "Inactive"}</Badge>
            <Button variant="outline" onClick={() => router.push(`/administration/departments/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-primary" />
            Department Head
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dept.deptHeadName ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">{dept.deptHeadName.charAt(0).toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">{dept.deptHeadName}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                  {head?.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{head.email}</span>}
                  {head?.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{head.phone}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">No department head assigned yet.</p>
              <Button asChild size="sm" variant="outline">
                <Link href="/administration/users/new">Assign Head</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Other Staff ({otherMembers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {otherMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other staff assigned to this department.</p>
          ) : (
            otherMembers.map((m) => (
              <Link
                key={m.uid}
                href={`/administration/users/${m.uid}/edit`}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">{m.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[m.role] ?? m.role} · {m.email}
                    {(m as unknown as { allLocationDepts?: boolean }).allLocationDepts && " · All Departments"}
                  </p>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium">{dept.isActive ? "Active" : "Inactive"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="font-medium">{formatDate(dept.createdAt as Parameters<typeof formatDate>[0])}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
