"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronRight, Eye, Trash2, UsersRound, History } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/shared/Avatar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ExportFacultyDialog } from "@/components/faculty/ExportFacultyDialog";
import { toast } from "@/hooks/useToast";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { isFacultyDestination } from "@/lib/departments/facultyDepartmentOptions";
import { DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { Department, Designation, FacultyMember, FacultyStatus, FMSUser } from "@/types";

// Selection checkboxes on this list (header "select all" + every row) - same
// sizing as the HOD Faculty Register's own export selection so both read
// consistently (hod/faculty/page.tsx SELECT_CHECKBOX_CLASS).
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-slate-500 bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
  RETAINERSHIP: "default",
};

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "INTERVIEW_DONE", label: "Interview Done" },
  { key: "ACTIVE", label: "Active" },
  { key: "RETAINERSHIP", label: "Retainership" },
  { key: "ON_LEAVE", label: "On Leave" },
  { key: "RESIGNED", label: "Resigned" },
  { key: "RETIRED", label: "Retired" },
];

export default function PrincipalDepartmentFacultyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { deptId } = useParams<{ deptId: string }>();
  const [statusFilter, setStatusFilter] = useState("");
  const [removingHod, setRemovingHod] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  // Export-only selection - when empty, ExportFacultyDialog exports everyone
  // currently shown (unchanged default behavior); picking specific rows here
  // narrows it to just those faculty members. Same pattern as hod/faculty/page.tsx.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: departments = [] } = useQuery({
    queryKey: ["principal-faculty-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const department = departments.find((d) => d.id === deptId);

  // A department split into sub-departments (e.g. Basic Science ->
  // BSC/BSM/BSP/BSE) is shown here as a picker into its children, since
  // faculty are actually filed under the sub-department, not the parent
  // (see isFacultyDestination's own comment) - unless the parent ALSO runs
  // its own sections/faculty directly, in which case both are shown.
  const subDepartments = department ? departments.filter((d) => d.parentDepartmentId === department.id) : [];
  const departmentIsFacultyDestination = department ? isFacultyDestination(department, departments) : true;

  const { data: hod } = useQuery({
    queryKey: ["principal-dept-hod", department?.hodUid],
    queryFn: () =>
      fetch("/api/college/users?role=HOD")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => d.users?.find((u) => u.uid === department?.hodUid) ?? null),
    enabled: !!department?.hodUid,
  });

  const { data: faculty = [], isLoading } = useQuery({
    queryKey: ["principal-dept-faculty", department?.name, statusFilter],
    queryFn: () =>
      fetch(
        `/api/college/faculty?department=${encodeURIComponent(department!.name)}${statusFilter ? `&status=${statusFilter}` : ""}`
      )
        .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
        .then((d) => d.faculty ?? []),
    enabled: !!department && departmentIsFacultyDestination,
  });

  // An HOD is almost always ALSO a teaching Faculty member of their own
  // department - when they have a real facultyMembers record (userUid links
  // it back to their login), "View/Edit HOD" should open THAT full profile
  // (Research, Teaching Load, every module) instead of the generic Staff
  // view, which deliberately hides those two modules for non-teaching roles
  // (see principal/staff/[uid]/page.tsx's excludeModules). Falls back to the
  // Staff view only for a bare HOD login with no Faculty record at all.
  const hodFaculty = faculty.find((f) => (f as unknown as { userUid?: string }).userUid === hod?.uid);

  // Switching status tabs (or departments) changes which rows exist at all -
  // a stale selection from before would otherwise silently export rows no
  // longer even shown.
  useEffect(() => {
    // Wrapped so the setState call isn't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect) - same pattern as
    // hod/faculty/page.tsx's own tab-switch selection reset.
    void Promise.resolve().then(() => setSelectedIds(new Set()));
  }, [statusFilter, deptId]);

  const allSelected = faculty.length > 0 && faculty.every((f) => selectedIds.has(f.id as string));
  const someSelected = faculty.some((f) => selectedIds.has(f.id as string)) && !allSelected;

  // Clears the department's HOD assignment. Deliberately NOT a delete of the
  // person: the same PATCH the Assign HOD dropdown already uses (hodUid: "")
  // also drops this department from their own profile's `departments`, so they
  // keep their login and any other department they head. Re-assign from
  // Departments → Assign HOD.
  async function handleRemoveHod() {
    if (!department || !hod) return;
    setIsRemoving(true);
    try {
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptId: department.id, hodUid: "", hodName: "" }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove HOD");
      toast({
        variant: "success",
        title: `${hod.name} is no longer HOD of ${department.name}`,
        description: "Their account is unchanged — assign a new HOD from Departments.",
      });
      setRemovingHod(false);
      await queryClient.invalidateQueries({ queryKey: ["principal-faculty-departments"] });
      await queryClient.invalidateQueries({ queryKey: ["principal-dept-hod"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove HOD" });
    } finally {
      setIsRemoving(false);
    }
  }

  const columns: Column<FacultyRow>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(checked) => setSelectedIds(checked ? new Set(faculty.map((f) => f.id as string)) : new Set())}
          aria-label="Select all faculty"
          className={SELECT_CHECKBOX_CLASS}
        />
      ),
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedIds.has(row.id as string)}
            onCheckedChange={(checked) =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (checked) next.add(row.id as string); else next.delete(row.id as string);
                return next;
              })
            }
            aria-label={`Select ${facultyDisplayName(row)}`}
            className={SELECT_CHECKBOX_CLASS}
          />
        </div>
      ),
    },
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl} size="sm" />
          <div>
            <p className="font-medium leading-tight">{facultyDisplayName(row)}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => DESIGNATION_LABELS[row.designation as Designation] ?? row.designation,
    },
    { key: "department", header: "Department", hideOnMobile: true },
    {
      key: "email",
      header: "Contact",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs">{row.collegeEmail || row.email}</p>
          {row.mobileNo && <p className="text-xs text-muted-foreground">{row.mobileNo}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Faculty"}
        description="Faculty members in this department"
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
                <Button variant="link" size="sm" className="h-auto p-0 pl-1.5 text-xs" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              </span>
            )}
            <ExportFacultyDialog
              faculty={selectedIds.size > 0 ? faculty.filter((f) => selectedIds.has(f.id as string)) : faculty}
              isSelection={selectedIds.size > 0}
            />
            <Button variant="outline" onClick={() => router.push("/principal/faculty")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
          </div>
        }
      />

      {department && (
        <div className="rounded-lg border p-4 flex items-center justify-between gap-3">
          {hod ? (
            <>
              <div className="flex items-center gap-3">
                <Avatar name={hod.name} photoUrl={hod.profilePhotoUrl} size="sm" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium leading-tight">{hod.name}</p>
                    <Badge variant="secondary">Head of Department</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{hod.email}{hod.phone ? ` · ${hod.phone}` : ""}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {/* Always stays inside the Faculty section - never the generic
                    Staff view (see hodFaculty's own comment above). With a real
                    Faculty record, this opens their full profile (view + edit via
                    its module tiles). Without one, it opens the SAME Add Faculty
                    form principal/faculty/new/page.tsx re-exports from HOD's own,
                    in its "link mode" (?linkUid=&department=&name=) - completing
                    it creates their Faculty record on the spot, so there's never
                    a need to fall back to Staff for a bare HOD login either. */}
                <Button size="sm" variant="outline" asChild>
                  <Link
                    href={
                      hodFaculty
                        ? `/principal/faculty/${deptId}/${hodFaculty.id}`
                        : `/principal/faculty/new?linkUid=${hod.uid}&department=${encodeURIComponent(department?.name ?? "")}&name=${encodeURIComponent(hod.name)}`
                    }
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />View HOD
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setRemovingHod(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Remove HOD
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-orange-500">No HOD assigned to this department yet</p>
          )}
        </div>
      )}

      {subDepartments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Sub-departments</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subDepartments.map((sd) => (
              <Card
                key={sd.id}
                className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
                onClick={() => router.push(`/principal/faculty/${sd.id}`)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{sd.name}</p>
                      <p className="text-xs text-muted-foreground">{sd.code}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {departmentIsFacultyDestination && (
        <>
          <div className="flex gap-2 flex-wrap">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  statusFilter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <DataTable
            data={faculty}
            columns={columns}
            isLoading={isLoading}
            keyExtractor={(f) => f.id}
            searchPlaceholder="Search by name, employee ID, or email..."
            searchKeys={["legalName", "nameAsPerPan", "employeeId", "email"] as (keyof FacultyRow)[]}
            // Same historical date-range view as hod/faculty's own Faculty
            // Timeline, scoped to this department - kept beside the search box
            // via DataTable's own filterComponent slot, same placement as hod/faculty.
            filterComponent={
              <Button variant="outline" size="sm" onClick={() => router.push(`/principal/faculty/${deptId}/timeline`)}>
                <History className="h-4 w-4 mr-1" />Faculty Timeline
              </Button>
            }
            emptyTitle="No faculty in this department"
            emptyDescription="Faculty added by the HOD for this department will appear here."
            onRowClick={(f) => router.push(`/principal/faculty/${deptId}/${f.id}`)}
          />
        </>
      )}

      {!department && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <UsersRound className="h-4 w-4" /> Resolving department…
        </p>
      )}

      <ConfirmDialog
        open={removingHod}
        onOpenChange={(open) => !open && setRemovingHod(false)}
        title={`Remove ${hod?.name ?? "this HOD"} as HOD?`}
        description={`${department?.name ?? "This department"} will have no HOD until you assign one from Departments. ${hod?.name ?? "They"} keeps their account and login — only the assignment is removed.`}
        confirmLabel={isRemoving ? "Removing..." : "Remove HOD"}
        variant="destructive"
        onConfirm={() => void handleRemoveHod()}
      />
    </div>
  );
}
