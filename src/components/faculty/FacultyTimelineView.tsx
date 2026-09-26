"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ExportFacultyDialog } from "@/components/faculty/ExportFacultyDialog";
import {
  TIMELINE_FILTER_MODES, TIMELINE_FILTER_LABELS, TIMELINE_FILTER_DATE_LABEL,
  facultyMatchesTimelineFilter, toDate, type TimelineFilterMode,
} from "@/lib/faculty/facultyTimeline";
import { FACULTY_STATUS_DATE_FIELD, FACULTY_STATUS_DATE_LABELS, DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, Designation, FacultyStatus } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
  RETAINERSHIP: "default",
};

// Same enlarged, high-contrast checkbox style as the Faculty Register's own
// select column (hod/faculty/page.tsx) - kept here rather than shared since
// it's a one-line className, not logic.
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-slate-500 bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

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

// Local-timezone "YYYY-MM-DD" (not toISOString(), which is UTC and can be off
// by a day near midnight IST) - same pattern already used for a From/To range
// picker's max bound elsewhere (hod/monthly-records/[sectionId]/page.tsx).
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateInputStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface AppliedFilter {
  mode: TimelineFilterMode;
  from: string;
  to: string;
}

interface FacultyTimelineViewProps {
  /** Where to fetch the faculty list from - already scoped (department, etc.) by the caller. */
  fetchUrl: string;
  /** Sidebar-register route to return to. */
  backHref: string;
  backLabel?: string;
  /** Where a row click / the Export dialog's per-row link (if any) should go. */
  rowHref: (row: FacultyRow) => string;
}

// A separate historical-data view of a Faculty Register - unlike a live
// status filter (e.g. the status pills on the main register tabs), this
// answers date-range questions across everyone's history regardless of their
// current status (e.g. "who resigned in 2023" still finds them even if later
// rehired and now Active again). Selecting rows and exporting them works the
// same way it does on the register itself (ExportFacultyDialog) - applying a
// timeline filter first, then picking exactly who from that filtered list to
// export, rather than requiring a separate trip back to the register.
export function FacultyTimelineView({ fetchUrl, backHref, backLabel = "Back to Faculty Register", rowHref }: FacultyTimelineViewProps) {
  const router = useRouter();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [mode, setMode] = useState<TimelineFilterMode>("activeDuring");
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  // Only set once "Apply" is pressed - the radio/date inputs above are a
  // draft config until then, so picking a mode or a date doesn't narrow the
  // list out from under someone still mid-selection. `null` (the initial
  // state, and after Clear) shows the full unfiltered roster.
  const [applied, setApplied] = useState<AppliedFilter | null>(null);

  useEffect(() => {
    fetch(fetchUrl)
      .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
      .then((d) => setFaculty(d.faculty ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }))
      .finally(() => setIsLoading(false));
  }, [fetchUrl]);

  const visibleFaculty = useMemo(() => {
    if (!applied) return faculty;
    return faculty.filter((f) => facultyMatchesTimelineFilter(f, applied.mode, applied.from, applied.to));
  }, [faculty, applied]);

  // Applying (or clearing) a filter changes which rows exist at all - a
  // selection carried over from a wider/narrower list would otherwise
  // silently export rows that are no longer even shown. Wrapped so the
  // setState call isn't reachable synchronously from the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => setSelectedIds(new Set()));
  }, [applied]);

  // Nobody on record joined before this - the earliest Date of Joining across
  // the whole loaded roster, so the pickers can't be set to a period no
  // faculty data could possibly exist in. Falls back to no floor at all if
  // the roster is empty or every joiningDate is somehow unparseable.
  const earliestJoiningStr = useMemo(() => {
    let earliest: Date | null = null;
    for (const f of faculty) {
      const d = toDate(f.joiningDate);
      if (d && (!earliest || d < earliest)) earliest = d;
    }
    return earliest ? toDateInputStr(earliest) : undefined;
  }, [faculty]);

  const today = todayStr();

  function handleApply() {
    if (fromDraft && fromDraft > today) {
      toast({ variant: "destructive", title: "'From' can't be a future date" });
      return;
    }
    if (toDraft && toDraft > today) {
      toast({ variant: "destructive", title: "'To' can't be a future date" });
      return;
    }
    if (fromDraft && toDraft && fromDraft > toDraft) {
      toast({ variant: "destructive", title: "'From' must be on or before 'To'" });
      return;
    }
    if (earliestJoiningStr && fromDraft && fromDraft < earliestJoiningStr) {
      toast({ variant: "destructive", title: `'From' can't be before ${earliestJoiningStr} - no faculty joined earlier than that` });
      return;
    }
    if (earliestJoiningStr && toDraft && toDraft < earliestJoiningStr) {
      toast({ variant: "destructive", title: `'To' can't be before ${earliestJoiningStr} - no faculty joined earlier than that` });
      return;
    }
    setApplied({ mode, from: fromDraft, to: toDraft });
  }
  function handleClear() {
    setMode("activeDuring");
    setFromDraft("");
    setToDraft("");
    setApplied(null);
  }

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
        <div className="flex items-center gap-3">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" />
          <div className="space-y-0.5">
            <p className="font-medium leading-tight">{facultyDisplayName(row)}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
          </div>
        </div>
      ),
    },
    { key: "department", header: "Department", hideOnMobile: true },
    {
      key: "designation",
      header: "Designation",
      hideOnMobile: true,
      render: (row) => DESIGNATION_LABELS[row.designation as Designation] ?? row.designation,
    },
    {
      key: "status",
      header: "Current Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? row.status}
        </Badge>
      ),
    },
    { key: "joiningDate", header: "Date of Joining", render: (row) => fmtDate(row.joiningDate) },
    {
      key: "statusDate",
      // Their current status's own date (if it has one) - Resignation/
      // Retirement/Retainership Date, whichever applies - shown regardless of
      // which filter mode is active, so the row that matched "resigned during
      // X" (say) always shows the date that actually matched.
      header: "Status Date",
      render: (row) => {
        const field = FACULTY_STATUS_DATE_FIELD[row.status as FacultyStatus];
        if (!field) return "-";
        return (
          <div>
            <p>{fmtDate(row[field])}</p>
            <p className="text-xs text-muted-foreground">{FACULTY_STATUS_DATE_LABELS[field]}</p>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {backLabel}
        </Link>
      </Button>

      <PageHeader
        title="Faculty Timeline"
        description="Historical record of faculty joining, resignation, retirement and retainership dates"
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
              faculty={selectedIds.size > 0 ? visibleFaculty.filter((f) => selectedIds.has(f.id as string)) : visibleFaculty}
              isSelection={selectedIds.size > 0}
            />
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            {TIMELINE_FILTER_MODES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="timelineMode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="h-4 w-4"
                />
                {TIMELINE_FILTER_LABELS[m]}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-2 border-t">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDraft}
                onChange={(e) => setFromDraft(e.target.value)}
                min={earliestJoiningStr}
                max={toDraft || today}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDraft}
                onChange={(e) => setToDraft(e.target.value)}
                min={fromDraft || earliestJoiningStr}
                max={today}
                className="h-9 w-40"
              />
            </div>
            <Button onClick={handleApply}>Apply</Button>
            <Button variant="outline" onClick={handleClear} disabled={!applied && !fromDraft && !toDraft}>
              Clear
            </Button>
          </div>

          {applied && (
            <p className="text-xs text-muted-foreground">
              Showing faculty matching &ldquo;{TIMELINE_FILTER_LABELS[applied.mode]}&rdquo;
              {applied.from || applied.to ? (
                <> ({TIMELINE_FILTER_DATE_LABEL[applied.mode]}{applied.from ? ` from ${applied.from}` : ""}{applied.to ? ` to ${applied.to}` : ""})</>
              ) : null}
              .
            </p>
          )}
        </CardContent>
      </Card>

      <DataTable
        data={visibleFaculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(row) => row.id as string}
        onRowClick={(row) => router.push(rowHref(row))}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["legalName", "nameAsPerPan", "email", "employeeId"] as (keyof FacultyRow)[]}
        emptyTitle="No matching faculty"
        emptyDescription={applied ? "No faculty match this filter - try a wider date range." : "No teaching faculty records yet."}
      />
    </div>
  );
}
