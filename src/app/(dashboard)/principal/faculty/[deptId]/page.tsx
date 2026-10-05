"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronRight, Eye, FileDown, LogIn, Pencil, Trash2, Upload, UserPlus, UsersRound, History } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/shared/Avatar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ExportFacultyDialog } from "@/components/faculty/ExportFacultyDialog";
import { ResumeSectionsDialog } from "@/components/faculty/ResumeSectionsDialog";
import { FacultyDesignationCell, FacultyExperienceCell, FacultyStatusCell, JoiningLine, type FacultyListRow } from "@/components/faculty/facultyListCells";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { downloadFacultyResume } from "@/lib/faculty/downloadFacultyResume";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";
import { isFacultyDestination } from "@/lib/departments/facultyDepartmentOptions";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import type { CollegeType, Department, FMSUser } from "@/types";

// Selection checkboxes on this list (header "select all" + every row) - same
// sizing as the HOD Faculty Register's own export selection so both read
// consistently (hod/faculty/page.tsx SELECT_CHECKBOX_CLASS).
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-slate-500 bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

type FacultyRow = FacultyListRow;

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
  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Export-only selection - when empty, ExportFacultyDialog exports everyone
  // currently shown (unchanged default behavior); picking specific rows here
  // narrows it to just those faculty members. Same pattern as hod/faculty/page.tsx.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Resume download - same flow as the HOD Faculty Register: Download opens a
  // section picker against the row, and generation waits for the choice.
  const [resumeTarget, setResumeTarget] = useState<FacultyRow | null>(null);
  const [downloadingResumeId, setDownloadingResumeId] = useState<string | null>(null);

  const { data: collegeInfo } = useQuery({
    queryKey: ["college-info"],
    queryFn: () =>
      fetch("/api/college/info")
        .then((r) => r.json() as Promise<{ name?: string; type?: CollegeType }>)
        .then((d) => ({ name: d.name ?? "", type: d.type })),
  });
  const collegeName = collegeInfo?.name ?? "";

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

  // Always fetched, even when this department organises sub-departments and
  // isn't a valid destination for a NEW faculty member (isFacultyDestination
  // is a picker rule, not a display rule) - a department can still have real
  // faculty already filed under it directly (added before sub-departments
  // existed, before "runs its own sections" was turned off, or via bulk
  // import), and gating the fetch itself on that picker rule silently hid
  // them with no way to ever see or export them again.
  const { data: faculty = [], isLoading } = useQuery({
    queryKey: ["principal-dept-faculty", department?.name, statusFilter],
    queryFn: () =>
      fetch(
        `/api/college/faculty?department=${encodeURIComponent(department!.name)}${statusFilter ? `&status=${statusFilter}` : ""}`
      )
        .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
        .then((d) => d.faculty ?? []),
    enabled: !!department,
    // The roster changes from other pages (Add/Import/Edit/Set Login all land
    // back here) and the app-wide 2-minute staleTime would otherwise show the
    // pre-change list.
    refetchOnMount: "always",
  });

  // An HOD is almost always ALSO a teaching Faculty member - when they have a
  // real facultyMembers record (userUid links it back to their login), "View
  // HOD" should open THAT full profile (Research, Teaching Load, every module)
  // instead of the generic Staff view, which deliberately hides those two
  // modules for non-teaching roles (see principal/staff/[uid]/page.tsx's
  // excludeModules). Resolved by the HOD's login uid across the whole college,
  // NOT from this department's roster: an HOD seat and a faculty record's
  // department are independent (someone can head Basic Science while their one
  // faculty record is filed under Information Technology). Falls back to the
  // Add Faculty link form only for a login with no Faculty record at all.
  const { data: hodFaculty, isLoading: hodFacultyLoading } = useQuery({
    queryKey: ["principal-hod-faculty-record", hod?.uid],
    queryFn: () =>
      fetch(`/api/college/faculty?userUid=${encodeURIComponent(hod!.uid)}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
        .then((d) => d.faculty?.[0] ?? null),
    enabled: !!hod?.uid,
    refetchOnMount: "always",
  });

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

  // Same delete the HOD's Faculty Register offers - DELETE /api/college/faculty/[id]
  // refuses (409) while the person still has teaching assignments/timetable slots,
  // and that reason is surfaced as-is rather than a blanket "failed".
  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/faculty/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to delete faculty record", description: json.error });
        return;
      }
      toast({ variant: "success", title: `${facultyDisplayName(deleteTarget)} removed from faculty register` });
      const deletedId = deleteTarget.id as string;
      setDeleteTarget(null);
      setSelectedIds((prev) => {
        if (!prev.has(deletedId)) return prev;
        const next = new Set(prev);
        next.delete(deletedId);
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["principal-dept-faculty"] });
    } catch {
      toast({ variant: "destructive", title: "Failed to delete faculty record", description: "Network error - please try again." });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDownloadResume(row: FacultyRow, sections: ResumeSectionKey[]) {
    setDownloadingResumeId(row.id as string);
    try {
      await downloadFacultyResume(row, collegeName, sections);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to generate resume" });
    } finally {
      setDownloadingResumeId(null);
      setResumeTarget(null);
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
      className: "whitespace-normal min-w-[13rem]",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{facultyDisplayName(row)}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
            <JoiningLine row={row} />
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      className: "whitespace-normal min-w-[9rem]",
      render: (row) => <FacultyDesignationCell row={row} />,
    },
    // Cells are nowrap by default; Department, Date of Joining, Contact and
    // Actions are allowed to wrap onto a second line so the extra
    // Joining/Experience columns don't push the table wider than the page.
    { key: "department", header: "Department", hideOnMobile: true, className: "whitespace-normal min-w-[8rem]" },
    {
      key: "joiningDate",
      header: "Date of Joining",
      hideOnMobile: true,
      className: "whitespace-normal min-w-[7rem]",
      render: (row) => <JoiningLine row={row} />,
    },
    {
      key: "totalYearsOfExperience",
      header: "Total Experience",
      hideOnMobile: true,
      render: (row) => <FacultyExperienceCell row={row} />,
    },
    {
      key: "email",
      header: "Contact",
      hideOnMobile: true,
      className: "whitespace-normal min-w-[8rem]",
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs break-all">{row.collegeEmail || row.email}</p>
          {row.mobileNo && <p className="text-xs text-muted-foreground">{row.mobileNo}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <FacultyStatusCell row={row} />,
    },
    {
      key: "actions",
      header: "",
      // May wrap onto a second line of buttons when the table is tight, so
      // every action stays visible without a sideways scroll.
      className: "whitespace-normal min-w-[16rem]",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          {!row.userUid && (
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              title="Create login account"
              onClick={(e) => { e.stopPropagation(); router.push(`/principal/faculty/${deptId}/${row.id}/credentials`); }}
            >
              <LogIn className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Set Login</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/principal/faculty/${deptId}/${row.id}`); }}>
            <Eye className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">View</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Download resume PDF"
            loading={downloadingResumeId === (row.id as string)}
            onClick={(e) => { e.stopPropagation(); setResumeTarget(row); }}
          >
            <FileDown className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Download</span>
          </Button>
          <Button variant="ghost" size="sm" title="Edit faculty details"
            onClick={(e) => { e.stopPropagation(); router.push(`/principal/faculty/${deptId}/${row.id}/edit`); }}>
            <Pencil className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete faculty record"
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
            <Button variant="outline" onClick={() => router.push("/principal/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <ExportFacultyDialog
              faculty={selectedIds.size > 0 ? faculty.filter((f) => selectedIds.has(f.id as string)) : faculty}
              isSelection={selectedIds.size > 0}
            />
            <Button onClick={() => router.push("/principal/faculty/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Faculty
            </Button>
            <Button variant="outline" onClick={() => router.push("/principal/faculty")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
          </div>
        }
      />

      {hasSupportingStaffSplit(collegeInfo?.type) && collegeInfo && (
        <SegmentedTabs
          value="faculty"
          options={[
            { key: "faculty", label: "Teaching Faculty", href: "/principal/faculty" },
            { key: "supporting", label: "Supporting Staff", href: "/principal/faculty/supporting-staff" },
          ]}
        />
      )}

      {department && (
        <div className="rounded-lg border p-4 flex items-center justify-between gap-3">
          {hod ? (
            <>
              <div className="flex items-center gap-3">
                {/* Prefers the linked faculty record's own honorific-prefixed
                    name (facultyDisplayName) over the plain users.name this
                    login was created with, which never carries the honorific
                    set afterward on the faculty record - falls back to
                    hod.name only while hodFaculty hasn't resolved yet, or for
                    an HOD login with no faculty record at all. */}
                <Avatar name={facultyDisplayName(hodFaculty) || hod.name} photoUrl={hod.profilePhotoUrl} size="sm" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium leading-tight">{facultyDisplayName(hodFaculty) || hod.name}</p>
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
                {/* Held back until the faculty-record lookup settles, so the
                    button never flashes the Add Faculty link for someone who
                    does have a record. */}
                {!hodFacultyLoading && (
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
                )}
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

      {/* Shown whenever this is a normal faculty destination, OR - even when
          it isn't - whenever faculty records already exist directly under it
          (see the query's own comment above) or the query is still resolving
          that. Never gated on isFacultyDestination alone, or real data filed
          under a since-reorganised parent department would stay invisible. */}
      {(departmentIsFacultyDestination || isLoading || faculty.length > 0) && (
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
            paginate
            data={faculty}
            columns={columns}
            isLoading={isLoading}
            keyExtractor={(f) => f.id}
            searchPlaceholder="Search by name, employee ID, or email..."
            searchKeys={["legalName", "nameAsPerPan", "employeeId", "email", "specialization"] as (keyof FacultyRow)[]}
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

      {resumeTarget && (
        <ResumeSectionsDialog
          open
          onOpenChange={(o) => { if (!o) setResumeTarget(null); }}
          personName={facultyDisplayName(resumeTarget) || "this faculty member"}
          downloading={downloadingResumeId === (resumeTarget.id as string)}
          onDownload={(sections) => handleDownloadResume(resumeTarget, sections)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete faculty record?"
        description={`This will permanently remove ${facultyDisplayName(deleteTarget) || "this faculty member"} (${(deleteTarget?.employeeId as string) ?? ""}) from the register${deleteTarget?.userUid ? " and delete their login account" : ""}. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />

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
