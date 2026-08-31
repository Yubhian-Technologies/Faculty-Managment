"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { UserPlus, Eye, Upload, Download, Trash2, LogIn, FileDown, UserCog } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { downloadResumePdf } from "@/lib/pdf/downloadResume";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, Designation, EmploymentType, FacultyStatus, TeachingAssignment, CollegeType, Department } from "@/types";

function fmtDate(val: unknown): string {
  if (!val) return "-";
  try {
    const ts = val as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
    const d = typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts?._seconds != null
        ? new Date(ts._seconds * 1000)
        : ts?.seconds != null
          ? new Date(ts.seconds * 1000)
          : null;
    if (!d || isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "-"; }
}

function fmtExp(val: unknown): string {
  if (val == null || val === "") return "0";
  return String(+(Number(val).toFixed(1)));
}

// INTERVIEW_DONE faculty haven't actually joined yet - their joiningDate is the
// proposed date from the offer letter, so it reads as an expectation, not a fact.
function joiningLabel(status: unknown): string {
  return status === "INTERVIEW_DONE" ? "Expected to join" : "Joined";
}

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

export default function HODFacultyPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadingResumeId, setDownloadingResumeId] = useState<string | null>(null);
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
    })();
  }, [statusFilter]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/faculty/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `${deleteTarget.name as string} removed from faculty register` });
      setDeleteTarget(null);
      void load(statusFilter);
    } catch {
      toast({ variant: "destructive", title: "Failed to delete faculty record" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDownloadResume(row: FacultyRow) {
    setDownloadingResumeId(row.id as string);
    try {
      let teachingAssignments: unknown[] = [];
      try {
        const taRes = await fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(row.id as string)}`);
        const taData = await taRes.json() as { assignments?: unknown[] };
        teachingAssignments = taData.assignments ?? [];
      } catch { /* non-critical - resume still generates without the live teaching-load table */ }
      let researchPublications: unknown[] = [];
      const researchUid = (row.userUid as string | undefined) ?? (row.uid as string | undefined);
      if (researchUid) {
        try {
          const pubRes = await fetch(`/api/college/publications?uid=${encodeURIComponent(researchUid)}`);
          const pubData = await pubRes.json() as { publications?: unknown[] };
          researchPublications = pubData.publications ?? [];
        } catch { /* non-critical - resume falls back to self-reported publications, if any */ }
      }
      await downloadResumePdf({ ...row, teachingAssignments, researchPublications, collegeName }, (row.employeeId as string) || (row.name as string));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to generate resume" });
    } finally {
      setDownloadingResumeId(null);
    }
  }

  async function handleExportAll() {
    setIsExporting(true);
    try {
      const teachingSummaries: Record<string, string> = {};
      try {
        const res = await fetch("/api/college/teaching-assignments?dept=true");
        const data = await res.json() as { assignments?: TeachingAssignment[] };
        for (const a of data.assignments ?? []) {
          const entry = `${a.courseName} Y${a.year}-${a.sectionName}: ${a.subjectName}`;
          teachingSummaries[a.facultyId] = teachingSummaries[a.facultyId] ? `${teachingSummaries[a.facultyId]}; ${entry}` : entry;
        }
      } catch { /* export still proceeds without the teaching summary column */ }

      exportFacultyCsv(faculty, teachingSummaries);
    } finally {
      setIsExporting(false);
    }
  }

  const STATUS_TABS = [
    { key: "", label: "All" },
    { key: "INTERVIEW_DONE", label: "Interview Done" },
    { key: "ACTIVE", label: "Active" },
    { key: "ON_LEAVE", label: "On Leave" },
    { key: "RESIGNED", label: "Resigned" },
    { key: "RETIRED", label: "Retired" },
  ];

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.name as string} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium leading-tight">{row.name as string}</p>
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
            <p className="text-xs text-muted-foreground">{joiningLabel(row.status)}: {fmtDate(row.joiningDate)}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>
          <p className="text-xs text-muted-foreground">{row.qualification as string}</p>
          {(row.specialization as string) && (
            <p className="text-xs text-muted-foreground italic">{row.specialization as string}</p>
          )}
          {(row.hasPHD as boolean) && (
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Ph.D</span>
          )}
        </div>
      ),
    },
    {
      key: "employmentType",
      header: "Employment",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-1">
          <Badge variant="outline">{EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? (row.employmentType as string)}</Badge>
          <p className="text-xs text-muted-foreground">{joiningLabel(row.status)}: {fmtDate(row.joiningDate)}</p>
        </div>
      ),
    },
    {
      key: "experienceYears",
      header: "Experience",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{fmtExp(row.experienceYears)} yrs</p>
          {Number(row.internalExperience) > 0 && (
            <p className="text-xs text-muted-foreground">Int: {fmtExp(row.internalExperience)} · Ext: {fmtExp(row.externalExperience)}</p>
          )}
          {Number(row.industryExperience) > 0 && (
            <p className="text-xs text-muted-foreground">Industry: {fmtExp(row.industryExperience)} yrs</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
            {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? (row.status as string)}
          </Badge>
          {(row.ratificationStatus as string) && (
            <p className={`text-[10px] font-medium ${row.ratificationStatus === "Ratified" ? "text-green-600" : "text-amber-600"}`}>
              {row.ratificationStatus as string}
            </p>
          )}
        </div>
      ),
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
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              title="Create login account"
              onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}/credentials`); }}
            >
              <LogIn className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Set Login</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}`); }}>
            <Eye className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">View</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Download resume PDF"
            loading={downloadingResumeId === (row.id as string)}
            onClick={(e) => { e.stopPropagation(); void handleDownloadResume(row); }}
          >
            <FileDown className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Download</span>
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
        title="Faculty Register"
        description="Teaching staff records for your department"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/hod/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button variant="outline" onClick={() => void handleExportAll()} loading={isExporting} disabled={isExporting || faculty.length === 0}>
              <Download className="h-4 w-4 mr-2" />Export All Details
            </Button>
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
                  <div className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 h-full ${href ? "transition-colors hover:bg-muted/50 hover:border-primary/40 cursor-pointer" : ""}`}>
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
                  </div>
                );
                return href ? <Link key={d.id} href={href}>{body}</Link> : <div key={d.id}>{body}</div>;
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        onRowClick={(row) => router.push(`/hod/faculty/${row.id}`)}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["name", "email", "employeeId", "specialization"] as (keyof FacultyRow)[]}
        emptyTitle="No teaching faculty records yet"
        emptyDescription="Add faculty members to build your department's staff register"
        emptyAction={<Button onClick={() => router.push("/hod/faculty/new")}><UserPlus className="h-4 w-4 mr-2" />Add Faculty</Button>}
      />

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete faculty record?"
        description={`This will permanently remove ${(deleteTarget?.name as string) ?? "this faculty member"} (${(deleteTarget?.employeeId as string) ?? ""}) from the register. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
