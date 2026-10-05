"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { UserPlus, Eye, Upload, Trash2, LogIn, FileDown, UserCog, History, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { ExportFacultyDialog } from "@/components/faculty/ExportFacultyDialog";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { downloadFacultyResume } from "@/lib/faculty/downloadFacultyResume";
import { ResumeSectionsDialog } from "@/components/faculty/ResumeSectionsDialog";
import { FacultyDesignationCell, FacultyExperienceCell, FacultyStatusCell, JoiningLine } from "@/components/faculty/facultyListCells";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { FacultyMember, CollegeType, Department } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

// Selection checkboxes on this list (header "select all" + every row): a bit larger than
// the shared Checkbox default, with a clear 2px black border and a white fill so an
// unchecked box reads against the white table - slate-500 still blended into the table's
// light background, so this is black instead of just a darker gray. Applied via className
// here so the shared Checkbox - used across the app - keeps its default look everywhere else.
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-black bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

export default function HODFacultyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  // "" = every department in the roster; otherwise one department's faculty.
  const [deptFilter, setDeptFilter] = useState<string>("");
  // Export-only selection - when empty, ExportFacultyDialog exports everyone
  // in the register (unchanged default behavior); picking specific rows here
  // narrows it to just those faculty members.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [downloadingResumeId, setDownloadingResumeId] = useState<string | null>(null);
  // The row whose Download was clicked - the section picker opens against it,
  // and the actual generation waits until the choice is made.
  const [resumeTarget, setResumeTarget] = useState<FacultyRow | null>(null);
  const [collegeName, setCollegeName] = useState("");
  const [collegeType, setCollegeType] = useState<CollegeType | undefined>(undefined);
  const myDepartments = useMyDepartments();
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name?: string; type?: CollegeType }>)
      .then((d) => { setCollegeName(d.name ?? ""); setCollegeType(d.type); })
      .catch(() => {});
  }, []);

  // The faculty list below already includes every true sub-department's own
  // faculty rows (see `load`'s comment), each tagged with its own department
  // badge - but nothing on this page previously surfaced WHO runs each
  // sub-department. A parent HOD managing e.g. "Basic Science" (split into
  // "BS Mathematics", "BS Chemistry", ...) needs that at a glance here, not
  // just on the separate Sub-Departments settings page. Mirrors that page's
  // own child-lookup (parentDepartmentId === my department's id) and its
  // `hodName` display (hod/settings/sub-departments/page.tsx).
  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  // Which sub-department's Sub-HOD is being removed - null when no dialog is
  // open. Same meaning as the Principal's Remove HOD on the department faculty
  // page: it clears the assignment, it doesn't touch the person's account.
  const [removingSubHod, setRemovingSubHod] = useState<Department | null>(null);
  const [isRemovingSubHod, setIsRemovingSubHod] = useState(false);

  async function handleRemoveSubHod() {
    if (!removingSubHod) return;
    setIsRemovingSubHod(true);
    try {
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // hodUid/hodName are both on the HOD-permitted field list for a
        // sub-department they own (see the route's HOD allowlist), so this is
        // the same call the Sub-Departments settings page already makes.
        body: JSON.stringify({ deptId: removingSubHod.id, hodUid: "", hodName: "" }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove Sub-HOD");
      toast({
        variant: "success",
        title: `${removingSubHod.hodName ?? "They"} is no longer Sub-HOD of ${removingSubHod.name}`,
        description: "Their account is unchanged — assign a new Sub-HOD from Sub-Departments.",
      });
      const removedId = removingSubHod.id;
      setRemovingSubHod(null);
      setDepartments((prev) =>
        prev.map((d) => (d.id === removedId ? { ...d, hodUid: undefined, hodName: undefined } : d))
      );
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove Sub-HOD" });
    } finally {
      setIsRemovingSubHod(false);
    }
  }

  const subDepartments = useMemo(() => {
    const ownIds = new Set(departments.filter((d) => myDepartments.includes(d.name)).map((d) => d.id));
    if (ownIds.size === 0) return [];
    return departments
      .filter((d) => d.parentDepartmentId && ownIds.has(d.parentDepartmentId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, myDepartments]);

  // A Sub-HOD's login (Department.hodUid, role "HOD" on their own `users`
  // doc) is never guaranteed to have a real facultyMembers record - no
  // HOD-creation flow writes one, since "just a normal HOD account, no
  // separate role" only ever touches `users`/`systemUsers` (see
  // CreateHodDialog/POST /api/college/users). Fetched independently of the
  // status-filterable `faculty` state above (unfiltered, status-agnostic) so
  // a Sub-HOD whose own record happens to be e.g. "On Leave" doesn't wrongly
  // look unlinked just because the current status pill filters it out.
  const [allFacultyForHodLookup, setAllFacultyForHodLookup] = useState<FacultyRow[]>([]);
  useEffect(() => {
    fetch("/api/college/faculty")
      .then((r) => r.json() as Promise<{ faculty?: FacultyRow[] }>)
      .then((d) => setAllFacultyForHodLookup(d.faculty ?? []))
      .catch(() => {});
  }, []);
  const facultyIdByUserUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of allFacultyForHodLookup) {
      const uid = f.userUid as string | undefined;
      if (uid) map.set(uid, f.id as string);
    }
    return map;
  }, [allFacultyForHodLookup]);

  async function load(status: string) {
    setIsLoading(true);
    try {
      // Default (unscoped) roster: a parent HOD runs their whole real
      // department tree, so true sub-departments' faculty belong here too -
      // but never a grouped/managed "core" branch's (CSE, IT, ...): unlike
      // Sections/Teaching Assignments (canHodEditDepartment), a managed
      // branch's actual faculty roster stays that branch's own business, for
      // the sub-HOD who coordinates it and the main HOD alike (see
      // canHodManageFacultyDepartment, lib/departments/scope.ts). Each row's
      // own department badge (below) keeps it clear which one a given
      // faculty member actually belongs to.
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/college/faculty?${params.toString()}`);
      const data = await res.json() as { faculty: FacultyRow[] };
      setFaculty(data.faculty ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load faculty" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
        await load(statusFilter);
        // Switching tabs changes which rows exist at all - a stale selection
        // from the previous tab would otherwise silently export rows no
        // longer even shown.
        setSelectedIds(new Set());
    })();
  }, [statusFilter]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/faculty/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        // The API already explains exactly why (e.g. "still has active
        // teaching assignments or timetable slots" - 409) - surface that
        // instead of a blanket "failed" message that hides the real reason.
        toast({ variant: "destructive", title: "Failed to delete faculty record", description: json.error });
        return;
      }
      toast({ variant: "success", title: `${facultyDisplayName(deleteTarget)} removed from faculty register` });
      setDeleteTarget(null);
      setSelectedIds((prev) => {
        if (!prev.has(deleteTarget.id as string)) return prev;
        const next = new Set(prev);
        next.delete(deleteTarget.id as string);
        return next;
      });
      void load(statusFilter);
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

  const STATUS_TABS = [
    { key: "", label: "All" },
    { key: "INTERVIEW_DONE", label: "Interview Done" },
    { key: "ACTIVE", label: "Active" },
    { key: "RETAINERSHIP", label: "Retainership" },
    { key: "ON_LEAVE", label: "On Leave" },
    { key: "RESIGNED", label: "Resigned" },
    { key: "RETIRED", label: "Retired" },
  ];

  // Departments present in the roster - shown as filter chips once the register
  // spans more than one (an HOD of several departments, or one with
  // sub-departments), so their faculty aren't lumped into a single list.
  const departmentChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of faculty) {
      const d = (f.department as string | undefined)?.trim();
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const names = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));
    return names.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [faculty]);
  const activeDeptFilter = departmentChips.some((c) => c.name === deptFilter) ? deptFilter : "";
  const visibleFaculty = useMemo(
    () => (activeDeptFilter ? faculty.filter((f) => (f.department as string | undefined)?.trim() === activeDeptFilter) : faculty),
    [faculty, activeDeptFilter]
  );

  const allSelected = visibleFaculty.length > 0 && visibleFaculty.every((f) => selectedIds.has(f.id as string));
  const someSelected = visibleFaculty.some((f) => selectedIds.has(f.id as string)) && !allSelected;

  const columns: Column<FacultyRow>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(checked) => setSelectedIds(checked ? new Set(visibleFaculty.map((f) => f.id as string)) : new Set())}
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
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium leading-tight">{facultyDisplayName(row)}</p>
              {/* Which department this faculty member actually belongs to -
                  now that the roster spans sub-departments/managed branches
                  too (not just this HOD's own), without this a faculty added
                  under a branch reads as if they belonged to the HOD's own
                  department instead. */}
              {(row.department as string) && (
                <Badge variant="secondary" className="text-[10px]">{row.department as string}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{(row.collegeEmail as string) || (row.email as string)}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
            <JoiningLine row={row} />
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => <FacultyDesignationCell row={row} />,
    },
    {
      key: "joiningDate",
      header: "Date of Joining",
      hideOnMobile: true,
      render: (row) => <JoiningLine row={row} />,
    },
    {
      key: "totalYearsOfExperience",
      header: "Total Experience",
      hideOnMobile: true,
      render: (row) => <FacultyExperienceCell row={row} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <FacultyStatusCell row={row} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          {!(row.userUid as string) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              title="Create login account"
              onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}/credentials`); }}
            >
              <LogIn className="h-4 w-4" /><span className="sr-only">Set Login</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="View profile"
            onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}`); }}
          >
            <Eye className="h-4 w-4" /><span className="sr-only">View</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Download resume PDF"
            loading={downloadingResumeId === (row.id as string)}
            onClick={(e) => { e.stopPropagation(); setResumeTarget(row); }}
          >
            <FileDown className="h-4 w-4" /><span className="sr-only">Download</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Edit faculty details"
            onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}/edit`); }}
          >
            <Pencil className="h-4 w-4" /><span className="sr-only">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Delete faculty record"
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
        title="Faculty Register"
        description="Teaching staff records for your department"
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
            <Button variant="outline" onClick={() => router.push("/hod/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <ExportFacultyDialog
              faculty={selectedIds.size > 0 ? faculty.filter((f) => selectedIds.has(f.id as string)) : visibleFaculty}
              isSelection={selectedIds.size > 0}
            />
            <Button onClick={() => router.push("/hod/faculty/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Faculty
            </Button>
          </div>
        }
      />

      {hasSupportingStaffSplit(collegeType) && (
        <SegmentedTabs
          value={pathname?.startsWith("/hod/supporting-staff") ? "supporting" : "faculty"}
          options={[
            { key: "faculty", label: "Teaching Faculty", href: "/hod/faculty" },
            { key: "supporting", label: "Supporting Staff", href: "/hod/supporting-staff" },
          ]}
        />
      )}

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${statusFilter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {departmentChips.length > 1 && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Department</span>
          {[{ name: "", count: faculty.length }, ...departmentChips].map((c) => (
            <button key={c.name || "all"} onClick={() => setDeptFilter(c.name)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${activeDeptFilter === c.name ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
              {c.name || "All Departments"} <span className="opacity-70">({c.count})</span>
            </button>
          ))}
        </div>
      )}

      {subDepartments.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Sub-Department HODs</p>
            <p className="text-xs text-muted-foreground mb-3">
              Click a Sub-HOD to view their full faculty profile, or complete it if it hasn&apos;t been added yet.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subDepartments.map((d) => {
                const facultyId = d.hodUid ? facultyIdByUserUid.get(d.hodUid) : undefined;
                const href = !d.hodUid
                  ? null
                  : facultyId
                    ? `/hod/faculty/${facultyId}`
                    : `/hod/faculty/new?linkUid=${encodeURIComponent(d.hodUid)}&department=${encodeURIComponent(d.name)}&name=${encodeURIComponent(d.hodName ?? "")}`;
                const body = (
                  <>
                    <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.name}</p>
                      {d.hodName
                        ? (
                          <p className="text-muted-foreground text-xs truncate">
                            {d.hodName} · Sub-HOD{href && !facultyId ? " · Complete profile" : ""}
                          </p>
                        )
                        : <p className="text-muted-foreground text-xs italic">No Sub-HOD assigned</p>}
                    </div>
                  </>
                );
                // The border moved out to this wrapper so Remove can sit
                // OUTSIDE the Link - nested inside it, every click would
                // navigate to the profile instead of opening the dialog.
                return (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 h-full ${href ? "transition-colors hover:bg-muted/50 hover:border-primary/40" : ""}`}
                  >
                    {href
                      ? <Link href={href} className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">{body}</Link>
                      : <div className="flex items-center gap-2 min-w-0 flex-1">{body}</div>}
                    {d.hodUid && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        title={`Remove ${d.hodName ?? "this Sub-HOD"} as Sub-HOD of ${d.name}`}
                        onClick={() => setRemovingSubHod(d)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable
        paginate
        data={visibleFaculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        onRowClick={(row) => router.push(`/hod/faculty/${row.id}`)}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["legalName", "nameAsPerPan", "email", "employeeId", "specialization"] as (keyof FacultyRow)[]}
        // A separate historical view (date-range filters over Date of
        // Joining/Resignation/Retirement/Retainership dates), not another
        // Faculty status filter - kept beside the search box via DataTable's
        // own filterComponent slot rather than a tab next to Teaching
        // Faculty/Supporting Staff above, so it doesn't read as a third
        // staff category.
        filterComponent={
          <Button variant="outline" size="sm" onClick={() => router.push("/hod/faculty/timeline")}>
            <History className="h-4 w-4 mr-1" />Faculty Timeline
          </Button>
        }
        emptyTitle="No teaching faculty records yet"
        emptyDescription="Add faculty members to build your department's staff register"
        // Only shown for the "All"/"Active" filters - the button reads as "Add
        // Faculty" generically, so offering it under a status like Resigned or
        // On Leave would wrongly suggest it creates a faculty member already in
        // that status.
        emptyAction={
          (statusFilter === "" || statusFilter === "ACTIVE")
            ? <Button onClick={() => router.push("/hod/faculty/new")}><UserPlus className="h-4 w-4 mr-2" />Add Faculty</Button>
            : undefined
        }
      />

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete faculty record?"
        description={`This will permanently remove ${facultyDisplayName(deleteTarget) || "this faculty member"} (${(deleteTarget?.employeeId as string) ?? ""}) from the register. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />

      {/* ── Remove Sub-HOD Confirm ── */}
      <ConfirmDialog
        open={!!removingSubHod}
        onOpenChange={(open) => { if (!open) setRemovingSubHod(null); }}
        title={`Remove ${removingSubHod?.hodName ?? "this Sub-HOD"} as Sub-HOD?`}
        description={`${removingSubHod?.name ?? "This sub-department"} will have no Sub-HOD until you assign one from Sub-Departments. ${removingSubHod?.hodName ?? "They"} keeps their account and login — only the assignment is removed.`}
        confirmLabel="Remove Sub-HOD"
        variant="destructive"
        onConfirm={() => void handleRemoveSubHod()}
        loading={isRemovingSubHod}
      />

      {/* ── Resume section picker ── */}
      {resumeTarget && (
        <ResumeSectionsDialog
          open
          onOpenChange={(o) => { if (!o) setResumeTarget(null); }}
          personName={facultyDisplayName(resumeTarget) || "this faculty member"}
          downloading={downloadingResumeId === (resumeTarget.id as string)}
          onDownload={(sections) => handleDownloadResume(resumeTarget, sections)}
        />
      )}
    </div>
  );
}
