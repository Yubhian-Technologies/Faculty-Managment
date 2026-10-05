"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Eye, Trash2, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { exportSupportingStaffCsv } from "@/lib/supportingStaff/exportCsv";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { SupportingStaffMember, SupportingStaffDesignation, FacultyStatus } from "@/types";

type StaffRow = Record<string, unknown> & SupportingStaffMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
  RETAINERSHIP: "default",
};

function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

// Library's own staff roster - same GET /api/college/supporting-staff the
// College Office list uses, but that route scopes it to the "Library" unit
// automatically for role LIBRARY (see api/college/supporting-staff/route.ts),
// so this list never needs a department filter of its own.
export default function LibraryStaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/supporting-staff");
      const data = (await res.json()) as { staff?: StaffRow[] };
      setStaff(data.staff ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load staff" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `${supportingStaffDisplayName(deleteTarget)} removed` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete staff record" });
    } finally {
      setIsDeleting(false);
    }
  }

  const columns: Column<StaffRow>[] = [
    {
      key: "name",
      header: "Staff Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={supportingStaffDisplayName(row) || "?"} photoUrl={row.profilePhotoUrl} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{supportingStaffDisplayName(row)}</p>
            {row.collegeEmail && <p className="text-xs text-muted-foreground">{row.collegeEmail}</p>}
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Role",
      render: (row) => (
        <p className="text-sm font-medium">
          {row.designation === "OTHER" && row.otherDesignationTitle ? row.otherDesignationTitle : designationLabel(row.designation)}
        </p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>{FACULTY_STATUS_LABELS[row.status] ?? row.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="View profile"
            onClick={(e) => { e.stopPropagation(); router.push(`/library/staff/${row.id}`); }}
          >
            <Eye className="h-4 w-4" /><span className="sr-only">View</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete staff record"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
          >
            <Trash2 className="h-4 w-4" /><span className="sr-only">Delete</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library Staff"
        description="Staff records for your Library unit"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exportSupportingStaffCsv(staff, "library_staff")} disabled={staff.length === 0}>
              <Download className="h-4 w-4 mr-2" />Export
            </Button>
            <Button onClick={() => router.push("/library/staff/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Staff
            </Button>
          </div>
        }
      />

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["legalName", "nameAsPerPan", "email", "employeeId"] as (keyof StaffRow)[]}
        emptyTitle="No Library staff yet"
        emptyDescription="Add staff to build your Library unit's records"
        emptyAction={<Button onClick={() => router.push("/library/staff/new")}><UserPlus className="h-4 w-4 mr-2" />Add Staff</Button>}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete staff record?"
        description={`This will permanently remove ${supportingStaffDisplayName(deleteTarget) || "this staff member"} (${deleteTarget?.employeeId ?? ""}). This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
