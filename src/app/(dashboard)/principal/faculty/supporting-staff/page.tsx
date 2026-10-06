"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/shared/Avatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { FACULTY_STATUS_VARIANTS, JoiningLine, type FacultyListRow } from "@/components/faculty/facultyListCells";
import { toast } from "@/hooks/useToast";
import { useCollegeType } from "@/hooks/useCollegeType";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, FACULTY_STATUS_LABELS, STAFF_CATEGORY_LABELS } from "@/types";
import type { FacultyStatus, SupportingStaffCategory, SupportingStaffMember } from "@/types";

// Principal / College Admin's READ-ONLY view of the college's Supporting
// Staff, reached from the Faculty section's "Supporting Staff" tab (shown only
// for colleges that keep supporting staff separate - hasSupportingStaffSplit).
//
// Deliberately no Add / Import / Export / Set Login / Edit / Delete here, and
// no edit route exists under this path: creating and maintaining supporting
// staff stays with their owners (Technical -> the department's HOD,
// Non-Technical -> College Office), and Principal's existing management of
// them lives in the Staff menu (principal/staff). This page only lets the
// Principal look at the records and open a profile.

type StaffRow = Record<string, unknown> & SupportingStaffMember;

const CATEGORY_TABS: { key: "" | SupportingStaffCategory; label: string }[] = [
  { key: "", label: "All" },
  { key: "NON_TECHNICAL", label: STAFF_CATEGORY_LABELS.NON_TECHNICAL },
  { key: "TECHNICAL", label: STAFF_CATEGORY_LABELS.TECHNICAL },
];

function roleLabel(row: StaffRow): string {
  if (row.designation === "OTHER" && row.otherDesignationTitle) return row.otherDesignationTitle;
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[row.designation] ?? row.designation;
}

export default function PrincipalSupportingStaffViewPage() {
  const router = useRouter();
  const { collegeType, loading: collegeTypeLoading } = useCollegeType();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<"" | SupportingStaffCategory>("");

  useEffect(() => {
    fetch("/api/college/supporting-staff")
      .then((r) => r.json() as Promise<{ staff?: StaffRow[] }>)
      .then((d) => setStaff(d.staff ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load Supporting Staff" }))
      .finally(() => setIsLoading(false));
  }, []);

  const visible = useMemo(() => (category ? staff.filter((s) => s.staffCategory === category) : staff), [staff, category]);
  const countOf = (key: "" | SupportingStaffCategory) => (key ? staff.filter((s) => s.staffCategory === key).length : staff.length);

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
            <JoiningLine row={row as unknown as FacultyListRow} />
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Role",
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{roleLabel(row)}</p>
          {row.highestQualification && <p className="text-xs text-muted-foreground">{row.highestQualification}</p>}
        </div>
      ),
    },
    {
      key: "staffCategory",
      header: "Category",
      hideOnMobile: true,
      render: (row) => <Badge variant="secondary" className="text-[10px]">{STAFF_CATEGORY_LABELS[row.staffCategory] ?? row.staffCategory}</Badge>,
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.department || "Centrally managed"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={FACULTY_STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          title="View profile"
          onClick={(e) => { e.stopPropagation(); router.push(`/principal/faculty/supporting-staff/${row.id}`); }}
        >
          <Eye className="h-4 w-4" /><span className="sr-only">View</span>
        </Button>
      ),
    },
  ];

  // A college type that keeps no separate supporting-staff register (a
  // School) has nothing to show here - point at the Staff menu instead.
  if (!collegeTypeLoading && !hasSupportingStaffSplit(collegeType)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Supporting Staff" description="Supporting staff for your college is managed from the Staff menu" />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Managed from Staff"
              description="This college type doesn't keep a separate supporting staff register. Use the Staff menu."
              icon={<UsersRound className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Supporting staff records across the college - view only"
      />

      <SegmentedTabs
        value="supporting"
        options={[
          { key: "faculty", label: "Teaching Faculty", href: "/principal/faculty" },
          { key: "supporting", label: "Supporting Staff", href: "/principal/faculty/supporting-staff" },
        ]}
      />

      <div className="flex gap-2 flex-wrap">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key || "all"}
            onClick={() => setCategory(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              category === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
            }`}
          >
            {tab.label} <span className="opacity-70">({countOf(tab.key)})</span>
          </button>
        ))}
      </div>

      <DataTable
        paginate
        data={visible}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        onRowClick={(row) => router.push(`/principal/faculty/supporting-staff/${row.id}`)}
        searchPlaceholder="Search by name, email, employee ID, department..."
        searchKeys={["legalName", "nameAsPerPan", "email", "collegeEmail", "employeeId", "department"] as (keyof StaffRow)[]}
        emptyTitle="No Supporting Staff records"
        emptyDescription="Supporting staff added by College Office or the department HODs will appear here."
      />
    </div>
  );
}
