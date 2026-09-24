"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { staffCoversLocationDept } from "@/lib/location/staffDepartments";
import { ROLE_LABELS } from "@/types";
import type { LocationDepartment, FMSUser } from "@/types";

// Read-only "who's assigned here" view - the Edit page (its own route,
// .../edit) stays just the rename/activate form. Staff coverage is read via
// staffCoversLocationDept (single source of truth shared with the Add/Edit
// Staff forms' own department pickers), not re-derived here.
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
      </div>
    );
  }
  if (!dept) return null;

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
        description="Staff currently assigned to this department"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={dept.isActive ? "default" : "secondary"}>{dept.isActive ? "Active" : "Inactive"}</Badge>
            <Button variant="outline" onClick={() => router.push(`/administration/departments/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Button>
          </div>
        }
      />

      {dept.deptHeadName && (
        <p className="text-sm text-muted-foreground">
          Dept Head: <span className="font-medium text-foreground">{dept.deptHeadName}</span>
        </p>
      )}

      <DataTable<Record<string, unknown>>
        data={staff as unknown as Record<string, unknown>[]}
        keyExtractor={(r) => (r as unknown as FMSUser).uid}
        searchPlaceholder="Search staff..."
        searchKeys={["name", "email"]}
        emptyTitle="No staff assigned to this department"
        emptyDescription="Assign HR Admin, Admin Office, Accounts or a Dept Head to this department from Location Staff."
        onRowClick={(r) => router.push(`/administration/users/${(r as unknown as FMSUser).uid}/edit`)}
        columns={[
          { key: "name", header: "Name" },
          { key: "email", header: "Email" },
          {
            key: "role", header: "Role",
            render: (r) => <Badge variant="secondary">{ROLE_LABELS[(r as unknown as FMSUser).role] ?? (r as unknown as FMSUser).role}</Badge>,
          },
        ]}
      />
    </div>
  );
}
