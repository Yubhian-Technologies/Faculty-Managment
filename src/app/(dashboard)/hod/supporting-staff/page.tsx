"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { FacultyModuleTabs } from "@/components/faculty/FacultyModuleTabs";
import { toast } from "@/hooks/useToast";
import {
  STAFF_CATEGORY_LABELS, TECHNICAL_STAFF_DESIGNATION_LABELS, NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
  EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS,
} from "@/types";
import type {
  SupportingStaffMember, SupportingStaffCategory, SupportingStaffDesignation,
  EmploymentType, FacultyStatus,
} from "@/types";

type StaffRow = Record<string, unknown> & SupportingStaffMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

function designationLabel(category: SupportingStaffCategory, designation: SupportingStaffDesignation): string {
  const labels = category === "TECHNICAL" ? TECHNICAL_STAFF_DESIGNATION_LABELS : NON_TECHNICAL_STAFF_DESIGNATION_LABELS;
  return (labels as Record<string, string>)[designation] ?? designation;
}

export default function HODSupportingStaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load(category: string) {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/supporting-staff${category ? `?staffCategory=${category}` : ""}`);
      const data = await res.json() as { staff: StaffRow[] };
      setStaff(data.staff ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load supporting staff" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(categoryFilter); }, [categoryFilter]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load(categoryFilter);
    } catch {
      toast({ variant: "destructive", title: "Failed to delete staff record" });
    } finally {
      setIsDeleting(false);
    }
  }

  const CATEGORY_TABS = [
    { key: "", label: "All" },
    { key: "TECHNICAL", label: "Technical" },
    { key: "NON_TECHNICAL", label: "Non-Technical" },
  ];

  const columns: Column<StaffRow>[] = [
    {
      key: "name",
      header: "Staff Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.name} photoUrl={row.profilePhotoUrl} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{row.name}</p>
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
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {row.designation === "OTHER" && row.otherDesignationTitle ? row.otherDesignationTitle : designationLabel(row.staffCategory, row.designation)}
          </p>
          <Badge variant="outline" className="text-xs">{STAFF_CATEGORY_LABELS[row.staffCategory]}</Badge>
        </div>
      ),
    },
    {
      key: "employmentType",
      header: "Employment",
      hideOnMobile: true,
      render: (row) => <Badge variant="outline">{EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? row.employmentType}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/hod/supporting-staff/${row.id}/edit`); }}>
            <Pencil className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supporting Staff"
        description="Technical and Non-Technical staff records for your department"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/hod/supporting-staff/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/hod/supporting-staff/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Staff
            </Button>
          </div>
        }
      />

      <FacultyModuleTabs facultyHref="/hod/faculty" supportingStaffHref="/hod/supporting-staff" />

      <div className="flex gap-2 flex-wrap">
        {CATEGORY_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setCategoryFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${categoryFilter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["name", "email", "employeeId"] as (keyof StaffRow)[]}
        emptyTitle="No supporting staff records yet"
        emptyDescription="Add Technical or Non-Technical staff to build your department's records"
        emptyAction={<Button onClick={() => router.push("/hod/supporting-staff/new")}><UserPlus className="h-4 w-4 mr-2" />Add Staff</Button>}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete staff record?"
        description={`This will permanently remove ${deleteTarget?.name ?? "this staff member"} (${deleteTarget?.employeeId ?? ""}). This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
