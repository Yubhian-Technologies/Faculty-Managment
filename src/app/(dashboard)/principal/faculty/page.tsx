"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Eye, FileDown, LogIn, Pencil, Search, Trash2, Upload, UserPlus, Users, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar } from "@/components/shared/Avatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { ExportFacultyDialog } from "@/components/faculty/ExportFacultyDialog";
import { ResumeSectionsDialog } from "@/components/faculty/ResumeSectionsDialog";
import { PeopleNotOnRoster } from "@/components/roles/PeopleNotOnRoster";
import {
  FacultyDesignationCell,
  FacultyExperienceCell,
  FacultyStatusCell,
  JoiningLine,
  type FacultyListRow,
} from "@/components/faculty/facultyListCells";
import { useCollegeType } from "@/hooks/useCollegeType";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { toast } from "@/hooks/useToast";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { downloadFacultyResume } from "@/lib/faculty/downloadFacultyResume";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";
import type { CollegeType, Department, FacultyMember, FacultyStatus } from "@/types";

const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-slate-500 bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

const ALL_DEPTS = "__ALL__";
const ALL_STATUS = "__ALL__";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_STATUS, label: "ALL — All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INTERVIEW_DONE", label: "Interview Done" },
  { value: "RETAINERSHIP", label: "Retainership" },
  { value: "ON_LEAVE", label: "On Leave" },
  { value: "RESIGNED", label: "Resigned" },
  { value: "RETIRED", label: "Retired" },
];

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "INTERVIEW_DONE", label: "Interview Done" },
  { key: "RETAINERSHIP", label: "Retainership" },
  { key: "ON_LEAVE", label: "On Leave" },
  { key: "RESIGNED", label: "Resigned" },
  { key: "RETIRED", label: "Retired" },
];

type FacultyRow = FacultyListRow;

function PrincipalFacultyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { collegeType, loading: collegeTypeLoading } = useCollegeType();

  // Filters state
  const [selectedDept, setSelectedDept] = useState<string>(searchParams.get("department") || ALL_DEPTS);
  const [selectedStatus, setSelectedStatus] = useState<string>(searchParams.get("status") || ALL_STATUS);

  // Loaded data state
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [statusTab, setStatusTab] = useState<string>("");

  // Selection & Actions state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resumeTarget, setResumeTarget] = useState<FacultyRow | null>(null);
  const [downloadingResumeId, setDownloadingResumeId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortControllerRef.current?.abort(); }, []);

  // Fetch departments list
  const { data: departments = [], isLoading: isDeptsLoading } = useQuery({
    queryKey: ["principal-faculty-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  // College info for resume export
  const { data: collegeInfo } = useQuery({
    queryKey: ["college-info"],
    queryFn: () =>
      fetch("/api/college/info")
        .then((r) => r.json() as Promise<{ name?: string; type?: CollegeType }>)
        .then((d) => ({ name: d.name ?? "", type: d.type })),
  });
  const collegeName = collegeInfo?.name ?? "";

  // Build department options with hierarchy (parent -> sub-departments)
  const departmentOptions = useMemo(() => {
    const topLevel = departments.filter((d) => !d.parentDepartmentId);
    const options: { value: string; label: string; isChild?: boolean }[] = [];

    for (const parent of topLevel) {
      options.push({ value: parent.name, label: `${parent.name} (${parent.code})` });
      const children = departments.filter((d) => d.parentDepartmentId === parent.id);
      for (const child of children) {
        options.push({ value: child.name, label: `↳ ${child.name} (${child.code})`, isChild: true });
      }
    }

    const orphans = departments.filter((d) => d.parentDepartmentId && !departments.some((p) => p.id === d.parentDepartmentId));
    for (const orphan of orphans) {
      options.push({ value: orphan.name, label: `${orphan.name} (${orphan.code})` });
    }

    return options;
  }, [departments]);

  // Load faculty with current filters
  const handleLoad = useCallback(async (dept = selectedDept, status = selectedStatus) => {
    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dept && dept !== ALL_DEPTS) params.set("department", dept);
      if (status && status !== ALL_STATUS) params.set("status", status);

      const res = await fetch(`/api/college/faculty?${params.toString()}`, { signal: ctrl.signal });
      const data = await res.json() as { faculty?: FacultyRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load faculty");

      setFaculty(data.faculty ?? []);
      setHasLoaded(true);
      setSelectedIds(new Set());
      setStatusTab(status !== ALL_STATUS ? status : "");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast({
        variant: "destructive",
        title: "Failed to load faculty",
        description: err instanceof Error ? err.message : "Network error - please try again",
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedDept, selectedStatus]);

  // Auto-load if navigated here with query parameters (e.g., from deep link)
  useEffect(() => {
    const deptParam = searchParams.get("department");
    const statusParam = searchParams.get("status");
    if (deptParam || statusParam) {
      const d = deptParam || ALL_DEPTS;
      const s = statusParam || ALL_STATUS;
      setSelectedDept(d);
      setSelectedStatus(s);
      void handleLoad(d, s);
    }
  }, [searchParams, handleLoad]);

  function handleReset() {
    setSelectedDept(ALL_DEPTS);
    setSelectedStatus(ALL_STATUS);
    setFaculty([]);
    setHasLoaded(false);
    setSelectedIds(new Set());
    setStatusTab("");
  }

  // Find department ID for a row to form links
  function getDeptIdForRow(row: FacultyRow): string {
    const match = departments.find((d) => d.name === row.department);
    return match?.id ?? "all";
  }

  // Client-side filtering by status tab
  const displayedFaculty = useMemo(() => {
    if (!statusTab) return faculty;
    return faculty.filter((f) => f.status === statusTab);
  }, [faculty, statusTab]);

  const countForStatus = (statusKey: string) => {
    if (!statusKey) return faculty.length;
    return faculty.filter((f) => f.status === statusKey).length;
  };

  // Selection
  const allSelected = displayedFaculty.length > 0 && displayedFaculty.every((f) => selectedIds.has(f.id as string));
  const someSelected = displayedFaculty.some((f) => selectedIds.has(f.id as string)) && !allSelected;
  const selectedFaculty = useMemo(() => faculty.filter((f) => selectedIds.has(f.id as string)), [faculty, selectedIds]);

  // Delete faculty handler
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
      setFaculty((prev) => prev.filter((f) => f.id !== deletedId));
    } catch {
      toast({ variant: "destructive", title: "Failed to delete faculty record", description: "Network error - please try again." });
    } finally {
      setIsDeleting(false);
    }
  }

  // Resume download handler
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
          onCheckedChange={(checked) => setSelectedIds(checked ? new Set(displayedFaculty.map((f) => f.id as string)) : new Set())}
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
            <p className="text-xs text-muted-foreground">ID: {row.employeeId || "-"}</p>
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
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      className: "whitespace-normal min-w-[8rem]",
      render: (row) => (
        <Badge variant="outline" className="font-normal text-xs">
          {row.department || "Unassigned"}
        </Badge>
      ),
    },
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
          <p className="text-xs break-all">{row.collegeEmail || row.email || "-"}</p>
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
      className: "whitespace-nowrap w-[130px]",
      render: (row) => {
        const dId = getDeptIdForRow(row);
        return (
          <div className="flex items-center gap-1">
            {!row.userUid && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                title="Create login account"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/principal/faculty/${dId}/${row.id}/credentials`);
                }}
              >
                <LogIn className="h-4 w-4" />
                <span className="sr-only">Set Login</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="View profile"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/principal/faculty/${dId}/${row.id}`);
              }}
            >
              <Eye className="h-4 w-4" />
              <span className="sr-only">View</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Download resume PDF"
              loading={downloadingResumeId === (row.id as string)}
              onClick={(e) => {
                e.stopPropagation();
                setResumeTarget(row);
              }}
            >
              <FileDown className="h-4 w-4" />
              <span className="sr-only">Download</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Edit faculty details"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/principal/faculty/${dId}/${row.id}/edit`);
              }}
            >
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Edit</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Delete faculty record"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(row);
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          </div>
        );
      },
    },
  ];

  const deptLabel = selectedDept === ALL_DEPTS ? "All Departments" : selectedDept;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Register"
        description="Filter and manage teaching faculty across all departments"
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-xs text-muted-foreground mr-1">
                {selectedIds.size} selected
                <Button variant="link" size="sm" className="h-auto p-0 pl-1.5 text-xs" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              </span>
            )}
            {hasLoaded && faculty.length > 0 && (
              <ExportFacultyDialog
                faculty={selectedFaculty.length > 0 ? selectedFaculty : displayedFaculty}
                isSelection={selectedFaculty.length > 0}
              />
            )}
            <Button variant="outline" onClick={() => router.push("/principal/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/principal/faculty/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Faculty
            </Button>
          </div>
        }
      />

      {/* Supporting Staff segmented tabs for colleges with split */}
      {!collegeTypeLoading && hasSupportingStaffSplit(collegeType) && (
        <SegmentedTabs
          value="faculty"
          options={[
            { key: "faculty", label: "Teaching Faculty", href: "/principal/faculty" },
            { key: "supporting", label: "Supporting Staff", href: "/principal/faculty/supporting-staff" },
          ]}
        />
      )}

      <PeopleNotOnRoster departments={departments} />

      {/* Filter and Load Control Bar */}
      <Card className="shadow-xs border-border/80">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4 flex-wrap">
              {/* Department Filter */}
              <div className="flex flex-col gap-1.5 min-w-[240px]">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Department
                </Label>
                <Select value={selectedDept} onValueChange={setSelectedDept} disabled={isDeptsLoading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={isDeptsLoading ? "Loading departments..." : "Select Department"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[320px]">
                    <SelectItem value={ALL_DEPTS} className="font-semibold text-primary">
                      ALL — All Departments
                    </SelectItem>
                    {departmentOptions.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className={opt.isChild ? "pl-6 text-muted-foreground text-xs" : "font-medium"}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="flex flex-col gap-1.5 min-w-[180px]">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Load Button */}
              <div className="flex items-center gap-2 pt-1 sm:pt-0">
                <Button
                  onClick={() => void handleLoad(selectedDept, selectedStatus)}
                  loading={isLoading}
                  className="min-w-[110px]"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Load
                </Button>
                {hasLoaded && (
                  <Button variant="outline" size="sm" onClick={handleReset} title="Reset filters">
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* Helper status text on right */}
            <div className="text-xs text-muted-foreground self-start lg:self-end">
              {hasLoaded ? (
                <span>
                  Showing <strong className="text-foreground font-semibold">{displayedFaculty.length}</strong> faculty
                  {selectedDept === ALL_DEPTS ? " across all departments" : ` in ${deptLabel}`}
                  {selectedStatus !== ALL_STATUS ? ` (${selectedStatus.toLowerCase()})` : ""}
                </span>
              ) : (
                <span>Select a department (or <strong>ALL</strong>) and click <strong>Load</strong></span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table or Not-loaded Prompt */}
      {!hasLoaded ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-base">Select Filters and Load Faculty</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Choose a department (or leave it as <strong>ALL</strong>) to view the faculty register. Click Load to retrieve records.
              </p>
            </div>
            <div className="pt-2">
              <Button onClick={() => void handleLoad(ALL_DEPTS, ALL_STATUS)} loading={isLoading}>
                <Users className="h-4 w-4 mr-2" />
                Load All Faculty
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Quick status tabs across the loaded roster */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {STATUS_TABS.map((tab) => {
              const active = statusTab === tab.key;
              const count = countForStatus(tab.key);
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatusTab(tab.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {tab.label}
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-foreground"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <DataTable
            data={displayedFaculty}
            columns={columns}
            isLoading={isLoading}
            keyExtractor={(r) => r.id as string}
            paginate
            defaultPageSize={20}
            searchPlaceholder="Search by name, employee ID, email, designation, or department..."
            searchKeys={["name", "legalName", "email", "collegeEmail", "employeeId", "designation", "department", "mobileNo"] as (keyof FacultyRow)[]}
            onRowClick={(row) => router.push(`/principal/faculty/${getDeptIdForRow(row)}/${row.id}`)}
            emptyTitle={statusTab ? `No ${statusTab.toLowerCase().replace(/_/g, " ")} faculty found` : "No faculty found"}
            emptyDescription={
              statusTab
                ? `There are no faculty members with status "${statusTab.toLowerCase().replace(/_/g, " ")}" in ${deptLabel}.`
                : `No faculty records found in ${deptLabel}.`
            }
            emptyAction={
              <Button onClick={() => router.push("/principal/faculty/new")}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Faculty
              </Button>
            }
          />
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${facultyDisplayName(deleteTarget)}?`}
        description={`This will permanently remove ${facultyDisplayName(deleteTarget)} from the faculty register. If they have active teaching assignments or timetable slots, the deletion will be prevented.`}
        confirmLabel="Delete Faculty"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />

      {/* Resume Section Picker Dialog */}
      <ResumeSectionsDialog
        personName={facultyDisplayName(resumeTarget)}
        open={!!resumeTarget}
        onOpenChange={(open) => { if (!open) setResumeTarget(null); }}
        onDownload={(sections) => {
          if (resumeTarget) void handleDownloadResume(resumeTarget, sections);
        }}
        downloading={!!downloadingResumeId}
      />
    </div>
  );
}

export default function PrincipalFacultyPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground animate-pulse">Loading faculty register...</div>}>
      <PrincipalFacultyContent />
    </Suspense>
  );
}
