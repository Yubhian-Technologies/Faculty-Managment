"use client";

import { FacultyTimetableLookup } from "@/components/timetable/FacultyTimetableLookup";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ChevronDown, ChevronRight, Clock, Coffee, FileDown, FileSpreadsheet, Lock, PencilLine, Plus, Send,
  Trash2, Upload, Utensils, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDMY } from "@/lib/utils";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { buildRows, defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { ordinalYear, resolveTimetableDays } from "@/lib/timetable/gridModel";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { TimetableHistoryPanel } from "@/components/timetable/TimetableHistoryPanel";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { buildSectionTimetablePdfHtml } from "@/lib/timetable/sectionTimetablePdf";
import { downloadSectionTimetableXlsx } from "@/lib/timetable/timetableExport";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import type {
  Course, Section, CourseYearTiming, TimetableSlot, DayOfWeek, DraftSlot, TimetableDraft,
  TeachingAssignment, FacultyAssignmentRequest, PeriodTiming, Subject,
} from "@/types";
import { DAY_LABELS, DEFAULT_TIMETABLE_RULES } from "@/types";

/** What the grid is currently showing. */
type Mode = "published" | "draft";

// Mirrors ImportPlacement from src/lib/timetable/import/parseGrid.ts (a
// server-only module - it pulls in mammoth/cheerio/firebase-admin, so this
// client component defines its own copy of the shape rather than importing
// it) plus the one client-side field (`included`) driving the preview's
// checkboxes.
interface ImportRow {
  day: DayOfWeek;
  startPeriod: number;
  blockSize: number;
  rawText: string;
  status: "matched" | "unmatched" | "ambiguous" | "conflict" | "unparsed";
  assignmentId?: string;
  subjectName?: string;
  facultyName?: string;
  candidates?: { assignmentId: string; subjectName: string; facultyName: string }[];
  error?: string;
  included: boolean;
}

const IMPORT_STATUS_LABEL: Record<ImportRow["status"], string> = {
  matched: "Matched",
  unmatched: "No match",
  ambiguous: "Ambiguous",
  conflict: "Conflict",
  unparsed: "Could not read",
};
const IMPORT_STATUS_VARIANT: Record<ImportRow["status"], "approved" | "rejected" | "pending"> = {
  matched: "approved",
  unmatched: "rejected",
  ambiguous: "pending",
  conflict: "rejected",
  unparsed: "pending",
};

interface TimetableGridEditorProps {
  courseId: string;
  year: string;
  sectionId: string;
  // Where "Back" returns to - the HOD's own section-list page for the HOD
  // route, or the Timetable Incharge's own equivalent for theirs (see
  // panel/timetable-incharge/[courseId]/[year]/[sectionId]/page.tsx). Kept as
  // a prop rather than hardcoded so this one component serves both URLs.
  // Optional: omitted when the grid is embedded under its own filter controls
  // (hod/timetable's Course/Year/Section pickers sit directly above it), where
  // "Back to sections" is meaningless - the filters ARE the way back. The
  // header, title and every export/edit action still render either way.
  backHref?: string;
}

// Shared by both hod/timetable/[courseId]/[year]/[sectionId]/page.tsx and
// panel/timetable-incharge/[courseId]/[year]/[sectionId]/page.tsx - an HOD
// and their delegated Timetable Incharge (see TimetableIncharge in
// src/types/core.ts) are both full co-editors of the exact same underlying
// data, so this is the one place that logic lives. Every fetch/action here
// goes through the same API routes either visitor already had server-side
// authorization checks added for (see teaching-assignments/timetable/
// timetable-slots routes' isTimetableIncharge branches).
export function TimetableGridEditor({ courseId, year, sectionId, backHref }: TimetableGridEditorProps) {
  const router = useRouter();
  const myDepartments = useMyDepartments();
  const searchParams = useSearchParams();
  // A lending HOD placing an allocated cross-department assignment (see
  // Assignment Requests) is viewing a section outside their own department -
  // /api/college/courses is scoped to the viewer's own department, so
  // `course` below resolves to null for them even though the grid itself
  // (timing/slots/draft/assignments, all looked up directly by id) works
  // fine. These carry the name through from the request they fulfilled,
  // purely as a title fallback. Only ever present on the HOD route.
  const fallbackCourseName = searchParams.get("courseName");
  const fallbackSectionName = searchParams.get("sectionName");
  // Present only when arriving via "Place on timetable" from Assignment
  // Requests - lets the requester get notified once this lending HOD commits
  // the periods (see handlePublish). Absent when navigated to directly (e.g.
  // straight from the sidebar) - "Update" vs "Publish" below doesn't depend
  // on it, since a managed/lent department reached that way is just as much
  // "someone else's" timetable.
  const fulfillingRequestId = searchParams.get("requestId");
  // The specific TeachingAssignment this lending HOD is fulfilling - folded
  // into myAssignmentIds below alongside anything else taught by their own
  // faculty, so the "Add a subject" picker and draft-state checks cover it
  // even before myFacultyIds has loaded.
  const fulfillingAssignmentId = searchParams.get("assignmentId") || null;

  const [course, setCourse] = useState<Course | null>(null);
  const { collegeInfo } = useCollegeInfo();
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  // Every year's own CourseYearTiming for this course (not just the one
  // being viewed) - powers the "Period Timings" summary at the top of the
  // page, so an HOD can see how every year's day is shaped (start/end time,
  // periods, breaks) without switching the year in the URL. The GET already
  // returns the whole course's timings in one call; this just keeps the
  // rest of them instead of discarding everything but the current year.
  const [allTimings, setAllTimings] = useState<CourseYearTiming[]>([]);
  // Which years' rows in the Period Timings summary have their period-by-
  // period breakdown expanded - collapsed by default so the summary stays a
  // short, scannable table, with the full per-period detail one click away.
  const [expandedTimingYears, setExpandedTimingYears] = useState<Set<number>>(new Set());
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  // The college's configured working days + subject codes, so the grid and
  // every export show the same days the server accepts and the same subject
  // short codes a teacher would recognise. Both come from the same
  // GET college/timetable-slots response that supplies the published slots.
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [draft, setDraft] = useState<TimetableDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Which top-level tab is showing - "History" is a fully separate,
  // read-only view (see TimetableHistoryPanel) of a PAST cohort's own
  // published timetable for this section; everything below (build/edit/
  // publish/discard) stays exactly as it always has and is untouched by it.
  const [activeView, setActiveView] = useState<"timetable" | "history">("timetable");

  const [modeState, setModeState] = useState<Mode>("published");
  // View filter, independent of edit mode - "ALL" shows everything as before.
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState<DraftSlot | null>(null);
  const [busy, setBusy] = useState<null | "publish" | "discard" | "move" | "blank">(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Manual timetabling: the section's assignments feed the add-subject picker,
  // and `addingAt` holds the empty cell the HOD clicked.
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [addingAt, setAddingAt] = useState<{ day: DayOfWeek; period: number } | null>(null);
  // Faculty ids this HOD actually manages (own + managed branches + true
  // sub-departments - "primary" per /api/college/faculty, excluding a
  // feeder's view-only "secondary" pool) - used to scope "Update" to only
  // the assignments taught by faculty they're responsible for. See
  // myAssignmentIds below.
  const [myFacultyIds, setMyFacultyIds] = useState<Set<string>>(new Set());
  // Assignment ids on this section fulfilled via a cross-department
  // Assignment Request (facultyAssignmentRequests.teachingAssignmentId, see
  // AssignmentRequestsPanel) - explicitly folded INTO myAssignmentIds below
  // for the "viewing cross-department, no specific request context" branch.
  // That branch otherwise scopes to myFacultyIds (this HOD's own/managed
  // faculty roster), which by definition can never include a lent-in
  // assignment's faculty - they're always from a genuinely different,
  // unrelated department (that's the whole point of lending). Without this,
  // a managed-branch HOD (e.g. a CS branch manager on a shared first-year
  // section actually owned by a common department like Basic Sciences) can
  // never see a lent-in subject in "Add a subject" at all, even though
  // they're the one who's supposed to place it now.
  const [lentInAssignmentIds, setLentInAssignmentIds] = useState<Set<string>>(new Set());
  // Editing state for the "Edit Period Timings" dialog - each period's own
  // start/end, within the college day the Principal already set
  // (timing.collegeStartTime/collegeEndTime). `period` numbers are always
  // derived from array position at save time (see handleSavePeriods), not
  // tracked per-row, so adding/removing a row never needs renumbering here.
  const [showPeriodDialog, setShowPeriodDialog] = useState(false);
  const [editPeriods, setEditPeriods] = useState<{ startTime: string; endTime: string }[]>([]);
  const [savingPeriods, setSavingPeriods] = useState(false);

  // Import-from-document: upload a Word/Excel timetable grid, preview what
  // it resolves to against this section's real teaching assignments, then
  // write only the rows the HOD kept checked into the draft (see
  // handleImportFile/handleImportConfirm below).
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importUploading, setImportUploading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // The days this grid can offer, in one place, for both published and draft
  // mode. Order comes from the college's TimetableRules.workingDays (the same
  // doc POST college/timetable-slots validates a new slot's `day` against), so
  // the editor can never offer a day the API would reject. Any day that already
  // has a published or draft slot is force-included, so toggling a working day
  // off can't silently hide classes that are already scheduled. Hardcoded
  // Mon-Sat is only the last-resort fallback for an unconfigured college.
  const days: DayOfWeek[] = useMemo(() => {
    const occupied = new Set<DayOfWeek>([
      ...slots.map((s) => s.day),
      ...((draft?.slots ?? []) as DraftSlot[]).map((s) => s.day),
    ]);
    return resolveTimetableDays({ workingDays: workingDays.length > 0 ? workingDays : DEFAULT_TIMETABLE_RULES.workingDays }, occupied);
  }, [workingDays, slots, draft]);

  const loadAll = useCallback(async () => {
    try {
      const [coursesData, sectionsData, timingsData, slotsData, draftData, assignData, facultyData, requestsData] = await Promise.all([
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
          .then((r) => r.json() as Promise<{ sections: Section[] }>),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
          .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[]; subjects?: Subject[]; workingDays?: DayOfWeek[] }>),
        fetch(`/api/college/timetable/draft?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ draft: TimetableDraft | null }>),
        fetch(`/api/college/teaching-assignments?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>),
        fetch("/api/college/faculty?availableOnly=true")
          .then((r) => r.json() as Promise<{ faculty: { id: string; accessLevel?: string }[] }>),
        fetch("/api/college/faculty-assignment-requests")
          .then((r) => r.json() as Promise<{ requests: FacultyAssignmentRequest[] }>),
      ]);

      setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
      setSection((sectionsData.sections ?? []).find((s) => s.id === sectionId) ?? null);
      setTiming((timingsData.timings ?? []).find((t) => t.year === Number(year)) ?? null);
      setAllTimings(timingsData.timings ?? []);
      setSlots(slotsData.slots ?? []);
      setSubjects(slotsData.subjects ?? []);
      setWorkingDays(slotsData.workingDays ?? DEFAULT_TIMETABLE_RULES.workingDays);
      setDraft(draftData.draft ?? null);
      setAssignments((assignData.assignments ?? []).filter((a) => !a.isPast));
      setMyFacultyIds(new Set((facultyData.faculty ?? []).filter((f) => f.accessLevel !== "secondary").map((f) => f.id)));
      setLentInAssignmentIds(new Set(
        (requestsData.requests ?? [])
          .filter((r) => r.sectionId === sectionId && r.teachingAssignmentId)
          .map((r) => r.teachingAssignmentId as string)
      ));
      // An unpublished draft is what the HOD most likely came here to act on.
      if (draftData.draft && draftData.draft.status === "DRAFT") setModeState("draft");
    } catch {
      toast({ variant: "destructive", title: "Failed to load timetable" });
    }
  }, [courseId, year, sectionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadAll();
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadAll]);

  const rows = timing ? buildRows(timing) : [];
  // A manually-started draft legitimately has zero slots, so toolbar visibility
  // keys off the draft existing - not off it having content.
  const hasDraft = Boolean(draft);
  // Whoever is editing isn't this section's own department - either they
  // have no direct access at all (`section` never resolved, reached only via
  // the "Place on timetable" deep link) or they're here via managed/feeder
  // access to a department that isn't literally their own (e.g. a BS
  // sub-HOD who manages CSE). Either way this is someone else's timetable,
  // so "Publish" reads as "Update" - see handlePublish. For a Timetable
  // Incharge visiting via the panel route, useMyDepartments() resolves to
  // their own home department, which is always this section's department by
  // construction (see the Incharge-assignment POST's own department-match
  // check) - so this naturally reads false for them too, same as an HOD
  // working within their own department.
  const isCrossDepartment = !isLoading && (!section || (myDepartments.length > 0 && !myDepartments.includes(section.department)));
  // A cross-department contributor never publishes this section themselves
  // (see handleNotify/handlePublish below and the server-side guard in
  // /api/college/timetable/publish) - so there's nothing for them to "view
  // published" either. Derived rather than a synced effect, so it can never
  // flash the wrong toggle state: always draft for them, never "Published".
  const mode: Mode = isCrossDepartment ? "draft" : modeState;
  // Which assignments on this section this HOD may actually place/move/remove
  // periods for - both here and in the "Add a subject" picker below, so
  // "Update"/"Publish" only ever touches their own subjects. Cross-department
  // still splits by how the viewer got here: arriving with no request context
  // (e.g. a BS sub-HOD opening a CSE section they fully manage straight from
  // the sidebar) is scoped to their own administered faculty's assignments
  // (myFacultyIds) PLUS any lent-in assignment on this section - myFacultyIds
  // can never cover a lent-in one (its faculty is always from a genuinely
  // different, unrelated department; that's the whole point of lending), so
  // without folding lentInAssignmentIds in here too, a managed-branch HOD
  // (e.g. a CS branch manager on a shared first-year section actually owned
  // by a common department like Basic Sciences) would never see a lent-in
  // subject in "Add a subject" at all, even though placing it is now their
  // job. Own section: every assignment, including a lent-in one - placing
  // its periods is this section's own HOD/Timetable Incharge's job like any
  // other subject now (the lending side only declares that faculty's busy
  // periods - see AssignmentRequestsPanel).
  const myAssignmentIds = isCrossDepartment
    ? fulfillingAssignmentId
      ? [fulfillingAssignmentId]
      : assignments
          .filter((a) => myFacultyIds.has(a.facultyId) || lentInAssignmentIds.has(a.id))
          .map((a) => a.id)
    : assignments.map((a) => a.id);
  // Same restriction, applied to the "Add a subject" picker - also excludes
  // whatever's already occupying the target cell (rawCellEntriesFor, not the
  // Theory/Practical-filtered cellEntriesFor - a cell hidden by the view
  // filter is still genuinely occupied), so a split-add can't double-place
  // the exact same assignment onto its own cell.
  const occupyingAtTarget = new Set(
    addingAt ? rawCellEntriesFor(addingAt.day, addingAt.period).map((e) => e.slot.assignmentId) : []
  );
  // A cell that already holds something is a split-add - only a lab
  // (PRACTICAL) subject may join it, and only when the existing occupant is a
  // lab too (validatePlacement enforces both), so the picker never offers a
  // theory subject there and the Split button never shows on a theory cell.
  const isSplitTarget = addingAt ? rawCellEntriesFor(addingAt.day, addingAt.period).length > 0 : false;
  const pickableAssignments = assignments.filter(
    (a) => myAssignmentIds.includes(a.id) && !occupyingAtTarget.has(a.id) && (!isSplitTarget || a.subjectType === "PRACTICAL")
  );
  const draftHasSlots = Boolean(draft?.slots?.length);
  // Gates the Update button specifically: having *some* slots in the draft
  // isn't enough if none of them are this HOD's own faculty's yet.
  const myDraftHasSlots = isCrossDepartment
    ? (draft?.slots ?? []).some((s) => myAssignmentIds.includes(s.assignmentId))
    : draftHasSlots;
  const draftIsUnpublished = draft?.status === "DRAFT";

  // Plural - a split period (two+ subjects/faculty sharing one section+day+
  // period, see timetable-slots/route.ts's allowSplit) means a cell can now
  // hold more than one occupant.
  function publishedSlotsFor(day: DayOfWeek, period: number) {
    return slots.filter((s) => s.day === day && s.periodNumber === period);
  }
  function draftSlotsFor(day: DayOfWeek, period: number) {
    return draft?.slots.filter((s) => s.day === day && s.periodNumber === period) ?? [];
  }
  /** Pinned slots stay visible in draft mode - the generator scheduled around them. */
  function pinnedSlotsFor(day: DayOfWeek, period: number) {
    return slots.filter((s) => s.day === day && s.periodNumber === period && s.source !== "GENERATED");
  }
  /**
   * Everything ACTUALLY occupying a cell, for whichever mode is showing -
   * regardless of the Theory/Practical view filter below. Used for real
   * occupancy checks (is this cell free, what's already here) that must
   * never be fooled by a hidden-by-filter entry - see cellEntriesFor, the
   * filtered version used for display. A split period (two+ subjects/
   * faculty sharing one section+day+period) means this can now hold more
   * than one entry. Draft mode unions pinned (locked, from the published
   * timetable) with the draft's own entries, deduped by assignmentId - a
   * pinned subject is never also independently present in draft.slots for
   * the same cell, but a split cell can legitimately have one pinned
   * occupant and one freshly-added draft occupant side by side.
   */
  function rawCellEntriesFor(day: DayOfWeek, period: number): { slot: TimetableSlot | DraftSlot; isPinned: boolean }[] {
    if (mode !== "draft") {
      return publishedSlotsFor(day, period).map((slot) => ({ slot, isPinned: slot.source !== "GENERATED" }));
    }
    const pinned = pinnedSlotsFor(day, period);
    const pinnedAssignmentIds = new Set(pinned.map((s) => s.assignmentId));
    return [
      ...pinned.map((slot) => ({ slot, isPinned: true })),
      ...draftSlotsFor(day, period)
        .filter((s) => !pinnedAssignmentIds.has(s.assignmentId))
        .map((slot) => ({ slot, isPinned: false })),
    ];
  }
  /** rawCellEntriesFor, narrowed to the Theory/Practical view filter - for
   *  display only. "ALL" (the default) shows every entry exactly as before.
   *  A slot with no resolved subjectType (e.g. a legacy row from before this
   *  field existed) still shows under "ALL". */
  function cellEntriesFor(day: DayOfWeek, period: number): { slot: TimetableSlot | DraftSlot; isPinned: boolean }[] {
    const entries = rawCellEntriesFor(day, period);
    return typeFilter === "ALL" ? entries : entries.filter((e) => e.slot.subjectType === typeFilter);
  }

  /** Opens the import dialog fresh - any previous preview/error is cleared. */
  function openImportDialog() {
    setImportRows(null);
    setImportError(null);
    setShowImportDialog(true);
  }

  /** Uploads a Word/Excel timetable grid and previews what it resolves to. Writes nothing yet. */
  async function handleImportFile(file: File) {
    setImportUploading(true);
    setImportError(null);
    setImportRows(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sectionId", sectionId);
      const res = await fetch("/api/college/timetable/import", { method: "POST", body: formData });
      const json = (await res.json()) as { placements?: Omit<ImportRow, "included">[]; error?: string };
      if (!res.ok) {
        setImportError(json.error ?? "Could not read this file");
        return;
      }
      // Pre-check only the cleanly matched rows - unmatched/ambiguous/conflict/
      // unparsed rows need the HOD's own judgment, never a default-on checkbox.
      setImportRows((json.placements ?? []).map((p) => ({ ...p, included: p.status === "matched" })));
    } catch {
      setImportError("Could not read this file");
    } finally {
      setImportUploading(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  /** Writes the checked, matched rows from the import preview into the draft. */
  async function handleImportConfirm() {
    if (!importRows) return;
    const toImport = importRows.filter((r) => r.included && r.status === "matched" && r.assignmentId);
    if (toImport.length === 0) return;
    setImportConfirming(true);
    try {
      const res = await fetch("/api/college/timetable/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          placements: toImport.map((r) => ({
            assignmentId: r.assignmentId, day: r.day, startPeriod: r.startPeriod, blockSize: r.blockSize,
          })),
        }),
      });
      const json = (await res.json()) as { imported?: number; failed?: { error?: string }[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Import failed" });
        return;
      }
      await loadAll();
      setModeState("draft");
      setIsEditing(true);
      setShowImportDialog(false);
      toast({
        title: `Imported ${json.imported ?? 0} period${json.imported === 1 ? "" : "s"}`,
        description: json.failed && json.failed.length > 0
          ? `${json.failed.length} row(s) could not be placed - they may now conflict with something else on the grid.`
          : undefined,
      });
    } finally {
      setImportConfirming(false);
    }
  }

  /** Starts an empty draft so the whole timetable can be built by hand. */
  async function handleStartBlank() {
    setBusy("blank");
    try {
      const res = await fetch("/api/college/timetable/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Could not start a blank timetable" });
        return;
      }
      await loadAll();
      setModeState("draft");
      setIsEditing(true);
      toast({ title: "Blank timetable started", description: "Click any period to add a subject." });
    } finally {
      setBusy(null);
    }
  }

  /** Places a teaching assignment (subject + its faculty) into the clicked cell. */
  async function handleAdd(assignment: TeachingAssignment) {
    if (!addingAt) return;
    setBusy("move");
    try {
      // Only a genuinely already-occupied cell opts into a split period -
      // the empty-cell "Add" flow never sets this, so it still gets the
      // normal double-booking rejection if something raced it. Reuses the
      // same isSplitTarget the picker itself was already filtered by.
      const allowSplit = isSplitTarget;
      const res = await fetch("/api/college/timetable/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          action: "add",
          assignmentId: assignment.id,
          toDay: addingAt.day,
          toPeriod: addingAt.period,
          allowSplit,
        }),
      });
      const json = (await res.json()) as { slots?: DraftSlot[]; error?: string; adjustedNote?: string | null };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Cannot add here", description: json.error });
        return;
      }
      setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
      setAddingAt(null);
      if (json.adjustedNote) toast({ title: "Lab spans a break", description: json.adjustedNote });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(slot: DraftSlot) {
    setBusy("move");
    try {
      const res = await fetch("/api/college/timetable/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          action: "remove",
          assignmentId: slot.assignmentId,
          fromDay: slot.day,
          fromPeriod: slot.periodNumber,
        }),
      });
      const json = (await res.json()) as { slots?: DraftSlot[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not remove", description: json.error });
        return;
      }
      setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
      setSelected(null);
    } finally {
      setBusy(null);
    }
  }

  // Cross-department: the placements were already saved into the shared
  // draft the moment they were clicked (handleAdd's PATCH), so there is
  // nothing left to publish here - this only notifies the requesting
  // department that their subject's periods are ready. Actually going live
  // stays with them: they publish the whole section from their own copy of
  // this same page, same as they would for any of their other subjects.
  async function handleNotify() {
    setBusy("publish");
    try {
      if (fulfillingRequestId) {
        const res = await fetch(`/api/college/faculty-assignment-requests/${fulfillingRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "notify_timetable_updated" }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: "Could not notify the requesting department", description: json.error });
          return;
        }
        toast({ variant: "success", title: "Requesting department notified", description: "They'll publish the timetable once everything is ready." });
      } else {
        toast({ variant: "success", title: "Periods saved", description: "The section's own HOD will publish the timetable once everything is ready." });
      }
      setIsEditing(false);
      setSelected(null);
    } finally {
      setBusy(null);
      setConfirmPublish(false);
    }
  }

  async function handlePublish() {
    if (isCrossDepartment) return handleNotify();
    setBusy("publish");
    try {
      const res = await fetch("/api/college/timetable/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      const json = (await res.json()) as { issues?: string[]; error?: string; published?: number };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Publish failed", description: json.issues?.slice(0, 2).join(" ") });
        return;
      }
      toast({ variant: "success", title: "Timetable published", description: "Now visible to the Principal, Vice Principal and faculty." });
      setIsEditing(false);
      setSelected(null);
      await loadAll();
      setModeState("published");
    } finally {
      setBusy(null);
      setConfirmPublish(false);
    }
  }

  async function handleDiscard() {
    setBusy("discard");
    try {
      const res = await fetch(`/api/college/timetable/draft?sectionId=${encodeURIComponent(sectionId)}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not discard the draft" });
        return;
      }
      toast({ variant: "success", title: "Draft discarded", description: "The published timetable is unchanged." });
      setIsEditing(false);
      setSelected(null);
      await loadAll();
      setModeState("published");
    } finally {
      setBusy(null);
      setConfirmDiscard(false);
    }
  }

  async function moveSelectedTo(day: DayOfWeek, period: number) {
    if (!selected) return;
    setBusy("move");
    try {
      const res = await fetch("/api/college/timetable/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          assignmentId: selected.assignmentId,
          fromDay: selected.day,
          fromPeriod: selected.periodNumber,
          toDay: day,
          toPeriod: period,
        }),
      });
      const json = (await res.json()) as { slots?: DraftSlot[]; error?: string; adjustedNote?: string | null };
      if (!res.ok) {
        // The server refuses moves that would break a hard constraint, and says why.
        toast({ variant: "destructive", title: "Cannot move here", description: json.error });
        return;
      }
      setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
      setSelected(null);
      if (json.adjustedNote) toast({ title: "Lab spans a break", description: json.adjustedNote });
    } finally {
      setBusy(null);
    }
  }

  function openPeriodDialog() {
    if (!timing) return;
    setEditPeriods(
      timing.periods && timing.periods.length > 0
        ? timing.periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime }))
        : defaultPeriodTimings(timing).map((p) => ({ startTime: p.startTime, endTime: p.endTime }))
    );
    setShowPeriodDialog(true);
  }

  function updateEditPeriod(idx: number, field: "startTime" | "endTime", value: string) {
    setEditPeriods((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }

  function addEditPeriod() {
    setEditPeriods((prev) => {
      const last = prev[prev.length - 1];
      // Picks up right where the previous period left off, same span as it
      // had - just a starting guess, every field stays freely editable.
      const spanMinutes = last
        ? (Number(last.endTime.slice(0, 2)) * 60 + Number(last.endTime.slice(3))) -
          (Number(last.startTime.slice(0, 2)) * 60 + Number(last.startTime.slice(3)))
        : 50;
      const startTime = last?.endTime ?? timing?.collegeStartTime ?? "09:00";
      const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
      const endMinutes = Math.min(startMinutes + spanMinutes, 23 * 60 + 59);
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
      return [...prev, { startTime, endTime }];
    });
  }

  function removeEditPeriod(idx: number) {
    setEditPeriods((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSavePeriods() {
    if (editPeriods.length === 0) {
      toast({ variant: "destructive", title: "Add at least one period" });
      return;
    }
    setSavingPeriods(true);
    try {
      const periods: PeriodTiming[] = editPeriods.map((p, i) => ({ period: i + 1, startTime: p.startTime, endTime: p.endTime }));
      const res = await fetch("/api/college/course-year-timings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, year: Number(year), periods }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not save period timings", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Period timings saved", description: "Applies to every section of this course & year." });
      setShowPeriodDialog(false);
      await loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingPeriods(false);
    }
  }

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  // The section document is the only source of batch/regulation/in-charge. When
  // it hasn't loaded we pass a name-only stand-in rather than the old fabricated
  // one (a four-year batch computed from the calendar, a studentCount of 60 and
  // an id echoed as a department) - printing a made-up batch is worse than
  // printing none.
  const printableSection: Partial<Section> | undefined =
    section ??
    (fallbackSectionName
      ? { name: fallbackSectionName, year: Number(year), courseName: course?.name ?? fallbackCourseName ?? undefined }
      : undefined);

  const exportFileBase = `Timetable_${(course?.name || fallbackCourseName || "Class").replace(/\s+/g, "_")}_Sec_${section?.name || fallbackSectionName || "A"}`;

  // `Section.department` is the department NAME string (see the join-key comment
  // on POST college/departments), so it is already printable - no name lookup
  // round-trip is needed for the header.
  const departmentName = section?.department;

  async function handleDownloadPdf() {
    if (!timing || slots.length === 0) return;
    setIsExportingPdf(true);
    try {
      const html = buildSectionTimetablePdfHtml({
        collegeName: collegeInfo?.name || "College",
        collegeCode: collegeInfo?.code,
        affiliation: collegeInfo?.affiliation,
        address: collegeInfo?.address,
        phone: collegeInfo?.phone,
        email: collegeInfo?.email,
        logoUrl: collegeInfo?.logoUrl,
        courseName: course?.name || fallbackCourseName || undefined,
        departmentName,
        section: printableSection,
        days,
        periods: Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1),
        periodTimings: timing.periods ?? [],
        timing,
        slots,
        subjects,
        assignments,
        lunchBreak: timing.lunchBreak,
        shortBreaks: timing.shortBreaks,
        academicYear: slots[0]?.academicYear,
      });
      const filename = `${exportFileBase}.pdf`;
      await renderHtmlToPdf(html, filename);
      toast({ title: "Timetable downloaded", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Download failed", description: "Failed to generate timetable PDF", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function handleDownloadXls() {
    if (!timing || slots.length === 0) return;
    setIsExportingXlsx(true);
    try {
      const filename = `${exportFileBase}.xlsx`;
      await downloadSectionTimetableXlsx(
        {
          collegeName: collegeInfo?.name,
          collegeCode: collegeInfo?.code,
          affiliation: collegeInfo?.affiliation,
          address: collegeInfo?.address,
          phone: collegeInfo?.phone,
          logoUrl: collegeInfo?.logoUrl,
          departmentName,
          courseName: course?.name || fallbackCourseName || undefined,
          academicYear: slots[0]?.academicYear,
          sectionName: printableSection?.name,
          sectionYear: printableSection?.year,
          batch: printableSection?.batch,
          regulation: printableSection?.regulation,
          classInchargeName: printableSection?.facultyInchargeName,
          days,
          periods: Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1),
          periodTimings: timing.periods ?? [],
          timing,
          slots,
          subjects,
          assignments,
          lunchBreak: timing.lunchBreak,
          shortBreaks: timing.shortBreaks,
        },
        filename
      );
      toast({ title: "Timetable exported", description: `Saved as ${filename}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: "Failed to export timetable spreadsheet", variant: "destructive" });
    } finally {
      setIsExportingXlsx(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          course && section
            ? `${course.name} · ${ordinalYear(Number(year))} · Section ${section.name}`
            : fallbackCourseName && fallbackSectionName
              ? `${fallbackCourseName} · ${ordinalYear(Number(year))} · Section ${fallbackSectionName}`
              : "Timetable"
        }
        description={
          mode === "draft"
            ? "Draft - not visible to faculty or students until published"
            : "Published timetable"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {backHref && (
              <Button variant="outline" onClick={() => router.push(backHref)}>
                <ArrowLeft className="h-4 w-4 mr-2" />Back
              </Button>
            )}
            {timing && slots.length > 0 && (
              <>
                <Button variant="outline" onClick={handleDownloadPdf} disabled={isExportingPdf || isExportingXlsx}>
                  <FileDown className="h-4 w-4 mr-2" />
                  {isExportingPdf ? "Preparing…" : "Download PDF"}
                </Button>
                <Button variant="outline" onClick={handleDownloadXls} disabled={isExportingPdf || isExportingXlsx}>
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" />
                  {isExportingXlsx ? "Preparing…" : "Export Excel"}
                </Button>
              </>
            )}
            {/* Manual route: an HOD can always build a timetable by hand -
                kept available cross-department too, since a lending HOD may
                be the first to touch this section's timetable at all and
                needs somewhere to click. */}
            {!hasDraft && (
              <Button variant="outline" onClick={handleStartBlank} loading={busy === "blank"} disabled={busy !== null}>
                <PencilLine className="h-4 w-4 mr-2" />
                {slots.length > 0 ? "Edit Timetable" : "Build manually"}
              </Button>
            )}
            {/* Upload an existing Word/Excel timetable grid instead of
                clicking every period by hand - same cross-department
                availability as Build manually above, and works whether or
                not a draft already exists (it appends into one either way,
                creating it first if needed - see the import/confirm route). */}
            {timing && (
              <Button variant="outline" onClick={openImportDialog}>
                <Upload className="h-4 w-4 mr-2" />Import
              </Button>
            )}
            {/* The college day's outer bounds are Principal-set - this only
                fills in this HOD's own period-by-period breakdown within
                them (see PATCH /api/college/course-year-timings), so it needs
                that record to already exist and isn't offered cross-department. */}
            {timing && !isCrossDepartment && (
              <Button variant="outline" onClick={openPeriodDialog}>
                <Clock className="h-4 w-4 mr-2" />Edit Period Timings
              </Button>
            )}
          </div>
        }
      />

      {/* Every year's college-day shape for this course, at a glance - handy
          at the start of a semester to see all years' periods/breaks without
          switching the year in the URL one at a time. Shows Year 1 through
          the course's own duration (falling back to 4 before `course` has
          loaded), with "Not configured yet" for a year the Principal hasn't
          set up. */}
      {!isLoading && allTimings.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/40 px-4 py-2 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Period Timings - {course?.name ?? "This Course"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="p-2 text-left font-medium text-muted-foreground w-8" />
                  <th className="p-2 text-left font-medium text-muted-foreground">Year</th>
                  <th className="p-2 text-left font-medium text-muted-foreground">College Hours</th>
                  <th className="p-2 text-left font-medium text-muted-foreground">Periods</th>
                  <th className="p-2 text-left font-medium text-muted-foreground">Lunch Break</th>
                  <th className="p-2 text-left font-medium text-muted-foreground">Short Breaks</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: course?.durationYears ?? 4 }, (_, i) => i + 1).map((y) => {
                  const t = allTimings.find((at) => Number(at.year) === y);
                  const isCurrentYear = y === Number(year);
                  const isExpanded = expandedTimingYears.has(y);
                  const periodTimes = t
                    ? (t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t))
                    : [];
                  return (
                    <Fragment key={y}>
                      <tr className={`${isExpanded ? "" : "border-b last:border-b-0"} ${isCurrentYear ? "bg-primary/5" : ""}`}>
                        <td className="p-2">
                          {t && (
                            <button
                              type="button"
                              onClick={() => setExpandedTimingYears((prev) => {
                                const next = new Set(prev);
                                if (next.has(y)) next.delete(y); else next.add(y);
                                return next;
                              })}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={isExpanded ? "Hide period times" : "Show period times"}
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </td>
                        <td className="p-2 font-medium text-foreground whitespace-nowrap">
                          {ordinalYear(y)}
                          {isCurrentYear && <span className="ml-1.5 text-[10px] font-normal text-primary">(current)</span>}
                        </td>
                        {t ? (
                          <>
                            <td className="p-2 text-muted-foreground whitespace-nowrap">
                              {formatTime12h(t.collegeStartTime)}&ndash;{formatTime12h(t.collegeEndTime)}
                            </td>
                            <td className="p-2 text-muted-foreground whitespace-nowrap">
                              {t.numberOfPeriods} &times; {t.periodDurationMinutes}m
                            </td>
                            <td className="p-2 text-muted-foreground whitespace-nowrap">
                              {t.lunchBreak ? `After P${t.lunchBreak.afterPeriod} · ${t.lunchBreak.durationMinutes}m` : "—"}
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {t.shortBreaks && t.shortBreaks.length > 0
                                ? t.shortBreaks.map((sb) => `After P${sb.afterPeriod} · ${sb.durationMinutes}m`).join(", ")
                                : "—"}
                            </td>
                          </>
                        ) : (
                          <td className="p-2 text-muted-foreground/60 italic" colSpan={4}>Not configured yet</td>
                        )}
                      </tr>
                      {isExpanded && t && (
                        <tr className={`border-b last:border-b-0 ${isCurrentYear ? "bg-primary/5" : ""}`}>
                          <td className="p-2" />
                          <td className="p-2 pt-0 pb-2.5 text-muted-foreground" colSpan={5}>
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {periodTimes.map((p) => (
                                <span key={p.period} className="whitespace-nowrap">
                                  <span className="font-medium text-foreground">P{p.period}</span>{" "}
                                  {formatTime12h(p.startTime)}&ndash;{formatTime12h(p.endTime)}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SegmentedTabs
        value={activeView}
        onChange={(v) => setActiveView(v as "timetable" | "history")}
        options={[
          { key: "timetable", label: "Timetable" },
          { key: "history", label: "History" },
        ]}
      />

      {activeView === "history" ? (
        <TimetableHistoryPanel courseId={courseId} year={year} sectionId={sectionId} />
      ) : (
      <>
      {/* ── Draft toolbar ─────────────────────────────────────────────────── */}
      {hasDraft && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            {!isCrossDepartment && (
              <Button size="sm" variant={mode === "published" ? "default" : "outline"} onClick={() => { setModeState("published"); setIsEditing(false); setSelected(null); }}>
                Published
              </Button>
            )}
            <Button size="sm" variant={mode === "draft" ? "default" : "outline"} onClick={() => setModeState("draft")}>
              Draft {draftIsUnpublished && <Badge variant="secondary" className="ml-1.5">unpublished</Badge>}
            </Button>
          </div>
          {/* Published mode: a draft already exists (its slots mirror exactly
              what was last published - see the publish route, which flips
              the draft to PUBLISHED in the same write instead of deleting
              it), so re-editing the live timetable is one click - jump
              straight to the draft, already in edit mode - rather than
              needing the HOD to first discover the Draft toggle above. */}
          {mode === "published" && !isCrossDepartment && (
            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setModeState("draft"); setIsEditing(true); setSelected(null); }}
              >
                <PencilLine className="h-4 w-4 mr-1.5" />Edit
              </Button>
            </div>
          )}
          {mode === "draft" && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant={isEditing ? "default" : "outline"} onClick={() => { setIsEditing((v) => !v); setSelected(null); }}>
                {isEditing ? <><X className="h-4 w-4 mr-1.5" />Done editing</> : "Edit"}
              </Button>
              {/* Discard wipes the whole section's draft, including anyone
                  else's placements - too destructive to hand to a
                  cross-department HOD who only owns a slice of it. */}
              {!isCrossDepartment && (
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(true)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4 mr-1.5" />Discard
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setConfirmPublish(true)}
                loading={busy === "publish"}
                disabled={busy !== null || !myDraftHasSlots}
                title={myDraftHasSlots ? undefined : "Add at least one period for your own faculty first"}
              >
                {isCrossDepartment
                  ? <><Send className="h-4 w-4 mr-1.5" />Notify department</>
                  : <><Upload className="h-4 w-4 mr-1.5" />Publish</>}
              </Button>
            </div>
          )}
        </div>
      )}

      {mode === "draft" && isEditing && (
        <p className="text-sm text-muted-foreground">
          {selected
            ? `Moving ${selected.subjectName} - click an empty period to place it, or click it again to cancel.`
            : "Click an empty period to add a subject, or a placed subject to move or remove it. Pinned slots and subjects lent in by another department cannot be changed here."}
        </p>
      )}

      {draft?.diagnostics?.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
          {draft.diagnostics.map((d, n) => <li key={n}>{d}</li>)}
        </ul>
      ) : null}

      {/* Any department's faculty and their real week - to check who is free
          before placing a subject. Replaces the old Theory/Practical toggle. */}
      <FacultyTimetableLookup embedded />

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(Number(year))} yet. Ask the Principal to set them up under Departments first.
        </div>
      ) : mode === "published" ? (
        <InstitutionalTimetableTable
          section={section}
          timing={timing}
          slots={slots}
          courseName={course?.name || fallbackCourseName || undefined}
          departmentName={departmentName}
          academicYear={slots[0]?.academicYear}
          workingDays={workingDays}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          subjects={subjects}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-20 sticky left-0 z-[5] bg-muted/95 backdrop-blur">
                  Day
                </th>
                {rows.map((row, idx) => {
                  if (row.kind === "lunch" || row.kind === "short") {
                    const Icon = row.kind === "lunch" ? Utensils : Coffee;
                    const label = row.kind === "lunch" ? "Lunch Break" : "Short Break";
                    return (
                      <th key={`break_${idx}`} className="p-2 text-center font-medium border-b bg-amber-50/60 min-w-[70px]">
                        <span className="flex flex-col items-center gap-0.5 text-amber-700">
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{label}</span>
                          <span className="text-[9.5px] font-normal text-amber-700/80">{row.durationMinutes} min</span>
                        </span>
                      </th>
                    );
                  }
                  return (
                    <th key={`period_${row.period}`} className="p-2.5 text-center font-medium text-muted-foreground border-b min-w-[110px]">
                      Period {row.period}
                      {row.startTime && row.endTime && (
                        <p className="text-[10px] font-normal whitespace-nowrap">
                          {formatTime12h(row.startTime)}&ndash;{formatTime12h(row.endTime)}
                        </p>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className="border-b last:border-b-0">
                  <td className="p-2.5 font-medium text-muted-foreground sticky left-0 z-[5] bg-background">
                    {DAY_LABELS[d]}
                  </td>
                  {rows.map((row, idx) => {
                    if (row.kind === "lunch" || row.kind === "short") {
                      return (
                        <td key={`break_${idx}`} className="p-2 text-center bg-amber-50/30 text-amber-700/40 font-mono">
                          &mdash;
                        </td>
                      );
                    }
                    const entries = cellEntriesFor(d, row.period);
                    // A cell already holding something can still take another
                    // subject (a split period) - shown as a small action below
                    // the existing entries, never replacing the "empty cell"
                    // Add button below, and never available in move-mode
                    // (a slot is selected) to avoid ambiguity with "Place here".
                    // Only a cell of lab (PRACTICAL) subjects, and not already
                    // shared by two, can be split any further.
                    const rawEntries = rawCellEntriesFor(d, row.period);
                    const canAddAnother = mode === "draft" && isEditing && !selected
                      && rawEntries.length < 2
                      && rawEntries.every((e) => assignments.find((a) => a.id === e.slot.assignmentId)?.subjectType === "PRACTICAL");

                    return (
                      <td key={`period_${row.period}`} className="p-2 align-top">
                        <div className="space-y-1">
                            {entries.map((entry) => {
                              const { slot, isPinned } = entry;
                              const dSlot = !isPinned && mode === "draft" ? (slot as DraftSlot) : undefined;
                              // A placed period this HOD doesn't own (e.g. a subject lent in
                              // through a cross-department Assignment Request) is shown same as
                              // a pinned slot - visible, but locked against move/remove here.
                              const isForeignSlot = Boolean(dSlot) && !myAssignmentIds.includes(dSlot!.assignmentId);
                              const isLocked = isPinned || isForeignSlot;
                              const isSelected =
                                selected && dSlot &&
                                selected.assignmentId === dSlot.assignmentId &&
                                selected.day === dSlot.day &&
                                selected.periodNumber === dSlot.periodNumber;
                              const clickable = mode === "draft" && isEditing && !isLocked;
                              const substituteFacultyName = "substituteFacultyName" in slot ? slot.substituteFacultyName : undefined;

                              return (
                                <button
                                  key={slot.assignmentId}
                                  type="button"
                                  disabled={!clickable || busy !== null}
                                  onClick={() => {
                                    if (!clickable || !dSlot) return;
                                    setSelected(isSelected ? null : dSlot);
                                  }}
                                  className={[
                                    "w-full text-left rounded-md border p-2 transition-colors",
                                    isLocked ? "bg-muted border-border" : "bg-primary/5 border-primary/20",
                                    isSelected ? "ring-2 ring-primary" : "",
                                    clickable ? "hover:border-primary cursor-pointer" : "cursor-default",
                                  ].join(" ")}
                                >
                                  <p className="text-xs font-semibold leading-tight flex items-center gap-1">
                                    {isLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                    {slot.subjectName}
                                  </p>
                                  {substituteFacultyName ? (
                                    <>
                                      <p className="text-[11px] font-medium text-amber-700 mt-0.5">{substituteFacultyName}</p>
                                      <p className="text-[10px] text-muted-foreground">
                                        Substituting for {(slot as TimetableSlot).substituteForName}
                                        {(slot as TimetableSlot).substituteDate ? ` (${formatDMY((slot as TimetableSlot).substituteDate!)})` : ""}
                                      </p>
                                    </>
                                  ) : (
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
                                  )}
                                  {"classroom" in slot && slot.classroom && (
                                    <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>
                                  )}
                                  {isSelected && dSlot && (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => { e.stopPropagation(); void handleRemove(dSlot); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault(); e.stopPropagation(); void handleRemove(dSlot);
                                        }
                                      }}
                                      className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-3 w-3" />Remove
                                    </span>
                                  )}
                                </button>
                              );
                            })}

                            {entries.length === 0 ? (
                              <button
                                type="button"
                                disabled={!(mode === "draft" && isEditing) || busy !== null}
                                onClick={() => {
                                  if (selected) void moveSelectedTo(d, row.period);
                                  else setAddingAt({ day: d, period: row.period });
                                }}
                                className={[
                                  "w-full rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground",
                                  mode === "draft" && isEditing
                                    ? "hover:border-primary hover:text-primary cursor-pointer"
                                    : "cursor-default",
                                ].join(" ")}
                              >
                                {mode === "draft" && isEditing
                                  ? (selected ? "Place here" : <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add</span>)
                                  : "-"}
                              </button>
                            ) : canAddAnother ? (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => setAddingAt({ day: d, period: row.period })}
                                className="w-full rounded-md border border-dashed p-1 text-center text-[10px] text-muted-foreground hover:border-primary hover:text-primary cursor-pointer"
                              >
                                <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Split - add subject</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual entry: pick which subject (and therefore which faculty) goes in
          the clicked period. One option per teaching assignment on this section,
          so the subject and its teacher always stay in step. */}
      <Dialog open={addingAt !== null} onOpenChange={(o) => { if (!o) setAddingAt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add a subject{addingAt ? ` - ${DAY_LABELS[addingAt.day]}, period ${addingAt.period}` : ""}
            </DialogTitle>
            <DialogDescription>
              {isSplitTarget
                ? `This period already has a subject - only a lab (Practical) subject can be added alongside it.`
                : `Pick a subject assigned to this section. Its faculty comes along automatically; labs take ${DEFAULT_TIMETABLE_RULES.labBlockSize} continuous periods.`}
            </DialogDescription>
          </DialogHeader>

          {pickableAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isSplitTarget
                ? "None of your remaining lab (Practical) subjects can be added here - only a lab may share an already-occupied period."
                : isCrossDepartment
                  ? "None of your faculty are assigned to this section yet. Add that under Teaching Assignments first."
                  : assignments.length > 0
                    ? "Every remaining subject was lent in through an Assignment Request - the lending department places its own periods from their side."
                    : "No subjects are assigned to this section yet. Add them under Teaching Assignments first."}
            </p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {pickableAssignments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleAdd(a)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.subjectName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.facultyName}</span>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs">{a.subjectCode}</Badge>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload a Word/Excel timetable grid, preview what it resolves to
          against this section's real teaching assignments, then write only
          the checked rows into the draft (see handleImportFile/
          handleImportConfirm above). */}
      <Dialog
        open={showImportDialog}
        onOpenChange={(o) => { if (!o && !importUploading && !importConfirming) setShowImportDialog(false); }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Timetable</DialogTitle>
            <DialogDescription>
              Upload a Word (.docx) or Excel (.xlsx) timetable grid for this section - the same Day x Period
              layout the department already keeps it in. Each cell is matched against this section&apos;s
              teaching assignments; only cleanly matched periods are pre-selected below.
            </DialogDescription>
          </DialogHeader>

          <input
            ref={importFileRef}
            type="file"
            accept=".docx,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />

          {!importRows && (
            <button
              type="button"
              disabled={importUploading}
              onClick={() => importFileRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-sm">
                {importUploading ? "Reading file…" : "Click to select a .docx or .xlsx file"}
              </p>
            </button>
          )}

          {importError && <p className="text-sm text-destructive">{importError}</p>}

          {importRows && (
            <>
              {importRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No filled-in periods were found in this document.</p>
              ) : (
                <div className="max-h-96 space-y-1.5 overflow-y-auto">
                  {importRows.map((row, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-3 rounded-md border p-2.5 text-sm has-[:disabled]:opacity-60"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={row.included}
                        disabled={row.status !== "matched"}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setImportRows((rows) => rows?.map((r, idx) => (idx === i ? { ...r, included: checked } : r)) ?? rows);
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {DAY_LABELS[row.day]}, period {row.startPeriod}
                            {row.blockSize > 1 ? `-${row.startPeriod + row.blockSize - 1}` : ""}
                          </span>
                          <Badge variant={IMPORT_STATUS_VARIANT[row.status]} className="text-xs">
                            {IMPORT_STATUS_LABEL[row.status]}
                          </Badge>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">&quot;{row.rawText}&quot;</span>
                        {row.status === "matched" && (
                          <span className="block text-xs text-muted-foreground">{row.subjectName} - {row.facultyName}</span>
                        )}
                        {row.error && <span className="block text-xs text-destructive">{row.error}</span>}
                        {row.candidates && row.candidates.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            Matches: {row.candidates.map((c) => `${c.subjectName} (${c.facultyName})`).join(", ")}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  {importRows.filter((r) => r.included).length} of {importRows.length} selected
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setImportRows(null); setImportError(null); }}
                    disabled={importConfirming}
                  >
                    Choose a different file
                  </Button>
                  <Button
                    onClick={() => void handleImportConfirm()}
                    loading={importConfirming}
                    disabled={importConfirming || importRows.filter((r) => r.included).length === 0}
                  >
                    Import {importRows.filter((r) => r.included).length} row(s)
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Free-form per-period start/end, within the college day the Principal
          already bounded (timing.collegeStartTime/collegeEndTime) - see
          PATCH /api/college/course-year-timings. Shared by every section of
          this course & year, not just this one. */}
      <Dialog open={showPeriodDialog} onOpenChange={(o) => { if (!o) setShowPeriodDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Period Timings</DialogTitle>
            <DialogDescription>
              {timing && (
                <>
                  Within the college day {formatTime12h(timing.collegeStartTime)}&ndash;{formatTime12h(timing.collegeEndTime)}.
                  Applies to every section of this course &amp; year, not just this one.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {editPeriods.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">Period {idx + 1}</span>
                <Input
                  type="time"
                  value={p.startTime}
                  onChange={(e) => updateEditPeriod(idx, "startTime", e.target.value)}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={p.endTime}
                  onChange={(e) => updateEditPeriod(idx, "endTime", e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => removeEditPeriod(idx)}
                  disabled={editPeriods.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addEditPeriod}>
            <Plus className="h-4 w-4 mr-1.5" />Add Period
          </Button>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => setShowPeriodDialog(false)} disabled={savingPeriods}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSavePeriods} loading={savingPeriods}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={isCrossDepartment ? "Notify the requesting department?" : "Publish this timetable?"}
        description={
          isCrossDepartment
            ? fulfillingRequestId
              ? "The periods you placed are already saved. This just lets the requesting department know they're ready - they'll publish the section's timetable themselves once everything else is in place."
              : "The periods you placed are already saved to this section's draft. Its own HOD will publish the timetable once everything else is ready."
            : "It becomes visible to the Principal, Vice Principal, every faculty member teaching this section, and the Class Leader. Any previously generated slots for this section are replaced; pinned slots are kept."
        }
        confirmLabel={isCrossDepartment ? "Notify" : "Publish"}
        loading={busy === "publish"}
        onConfirm={handlePublish}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft?"
        description="The draft is deleted. The currently published timetable is not affected."
        confirmLabel="Discard"
        variant="destructive"
        loading={busy === "discard"}
        onConfirm={handleDiscard}
      />
      </>
      )}
    </div>
  );
}
