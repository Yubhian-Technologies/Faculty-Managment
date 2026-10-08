"use client";

import { FacultyTimetableLookup } from "@/components/timetable/FacultyTimetableLookup";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ChevronDown, ChevronRight, Clock, Coffee, Lock, PencilLine, Plus, Send,
  Trash2, Upload, Utensils, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDMY } from "@/lib/utils";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { buildRows, defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { continuousSpans, ordinalYear, readableCode, resolveTimetableDays } from "@/lib/timetable/gridModel";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { requestAssignmentIds } from "@/lib/teaching/requestAllocations";
import type {
  Course, SectionListItem, CourseYearTiming, TimetableSlot, DayOfWeek, DraftSlot, TimetableDraft,
  TeachingAssignment, FacultyAssignmentRequest, PeriodTiming, Subject,
} from "@/types";
import { DAY_LABELS, DEFAULT_TIMETABLE_RULES } from "@/types";
import { courseYearNumbers } from "@/lib/college/courseYears";
import { SUBJECT_COLORS, isSubjectColor } from "@/lib/timetable/subjectColors";

/** What the grid is currently showing. */
type Mode = "published" | "draft";

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
  // Which semester's timetable this grid shows and edits. Omitted (or null) lets
  // the server resolve whichever semester is running today, as before.
  semester?: number | null;
}

// Shared by both hod/timetable/[courseId]/[year]/[sectionId]/page.tsx and
// panel/timetable-incharge/[courseId]/[year]/[sectionId]/page.tsx - an HOD
// and their delegated Timetable Incharge (see TimetableIncharge in
// src/types/core.ts) are both full co-editors of the exact same underlying
// data, so this is the one place that logic lives. Every fetch/action here
// goes through the same API routes either visitor already had server-side
// authorization checks added for (see teaching-assignments/timetable/
// timetable-slots routes' isTimetableIncharge branches).
export function TimetableGridEditor({ courseId, year, sectionId, backHref, semester }: TimetableGridEditorProps) {
  const semesterQuery = semester != null ? `&semester=${semester}` : "";
  const semesterBody = semester != null ? { semester } : {};
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

  // "Subject colors" picker: the subject + colour chosen, applied on Add.
  const [colorPickId, setColorPickId] = useState("");
  const [colorPickColor, setColorPickColor] = useState<keyof typeof SUBJECT_COLORS | "">("");
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<SectionListItem | null>(null);
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

  const [modeState, setModeState] = useState<Mode>("published");
  // View filter, independent of edit mode - "ALL" shows everything as before.
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState<DraftSlot | null>(null);
  const [busy, setBusy] = useState<null | "publish" | "discard" | "move" | "blank" | "reset">(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  // "Merge cells": the user picks back-to-back periods of one subject on a day and
  // they are saved as a single cell (the slots carry mergeWithNext; every view and
  // download draws them merged). `mergePick` is the current selection.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergePick, setMergePick] = useState<{ day: DayOfWeek; periods: number[] }>({ day: "MON", periods: [] });
  // "w.e.f" date printed on the timetable, asked for in the publish dialog.
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Manual timetabling: the section's assignments feed the add-subject picker,
  // and `addingAt` holds the empty cell the HOD clicked.
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [addingAt, setAddingAt] = useState<{ day: DayOfWeek; period: number } | null>(null);
  // A subject with more than one faculty in this section was picked: ask whether they all go in
  // this cell together, or only the picked one (the others are added separately).
  const [sharePrompt, setSharePrompt] = useState<{ picked: TeachingAssignment; others: TeachingAssignment[] } | null>(null);
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
  // Lent-in assignments the lending department hasn't yet closed with "Notify
  // & close" (request.busyClosed) - still declaring busy periods, so not ready
  // to be placed. Held back from "Add a subject" until they close it.
  const [notReadyLentInIds, setNotReadyLentInIds] = useState<Map<string, string>>(new Map()); // assignment id -> lending department
  // Editing state for the "Edit Period Timings" dialog - each period's own
  // start/end, within the college day the Principal already set
  // (timing.collegeStartTime/collegeEndTime). `period` numbers are always
  // derived from array position at save time (see handleSavePeriods), not
  // tracked per-row, so adding/removing a row never needs renumbering here.
  const [showPeriodDialog, setShowPeriodDialog] = useState(false);
  const [editPeriods, setEditPeriods] = useState<{ startTime: string; endTime: string }[]>([]);
  const [savingPeriods, setSavingPeriods] = useState(false);

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
          .then((r) => r.json() as Promise<{ sections: SectionListItem[] }>),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
          .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[]; subjects?: Subject[]; workingDays?: DayOfWeek[] }>),
        fetch(`/api/college/timetable/draft?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`)
          .then((r) => r.json() as Promise<{ draft: TimetableDraft | null }>),
        fetch(`/api/college/teaching-assignments?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>),
        fetch("/api/college/faculty?availableOnly=true")
          .then((r) => r.json() as Promise<{ faculty: { id: string; accessLevel?: string }[] }>),
        fetch(`/api/college/faculty-assignment-requests?sectionId=${encodeURIComponent(sectionId)}`)
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
      // A request can hold several allocated faculty - every one of their assignments counts.
      setLentInAssignmentIds(new Set(
        (requestsData.requests ?? [])
          .filter((r) => r.sectionId === sectionId)
          .flatMap((r) => requestAssignmentIds(r))
      ));
      setNotReadyLentInIds(new Map(
        (requestsData.requests ?? [])
          .filter((r) => r.sectionId === sectionId && r.status === "ALLOCATED" && !r.busyClosed)
          .flatMap((r) => requestAssignmentIds(r).map((id) => [id, r.targetDepartmentName] as const))
      ));
      // An unpublished draft is what the HOD most likely came here to act on.
      if (draftData.draft && draftData.draft.status === "DRAFT") setModeState("draft");
    } catch {
      toast({ variant: "destructive", title: "Failed to load timetable" });
    }
  }, [courseId, year, sectionId, semesterQuery]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadAll();
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadAll]);

  // The color the editor picked for a subject's cells (default tint when none).
  const cellTint = (assignmentId: string) => {
    const c = assignments.find((a) => a.id === assignmentId)?.cellColor;
    return isSubjectColor(c) ? SUBJECT_COLORS[c].cell : "bg-primary/5 border-primary/20";
  };

  const setCellColor = async (assignmentId: string, color: string | null) => {
    const prev = assignments;
    // A co-taught/split subject (several faculty, same subject, same section)
    // is several assignment docs - colour every one of them together, so
    // colouring any one faculty's half colours the whole subject everywhere
    // it's shown, the editor included. The server does the same grouping
    // (see subject-color PATCH), this is just the optimistic local mirror.
    const subjectId = prev.find((a) => a.id === assignmentId)?.subjectId;
    const siblingIds = new Set(
      prev.filter((a) => a.id === assignmentId || (subjectId && a.subjectId === subjectId)).map((a) => a.id)
    );
    setAssignments((list) => list.map((a) => (siblingIds.has(a.id) ? { ...a, cellColor: color ?? undefined } : a)));
    // Published slots carry the colour too (see timetable-slots GET) - keep the Published view in step.
    setSlots((list) => list.map((s) => (siblingIds.has(s.assignmentId) ? { ...s, cellColor: color ?? undefined } : s)));
    const res = await fetch("/api/college/timetable/subject-color", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId, color }),
    });
    if (!res.ok) {
      setAssignments(prev);
      setSlots((list) => list.map((s) => (siblingIds.has(s.assignmentId) ? { ...s, cellColor: prev.find((a) => a.id === s.assignmentId)?.cellColor } : s)));
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ variant: "destructive", title: err.error ?? "Could not save the color" });
    }
  };

  // Most assignments were saved without a shortCode - the subject itself has it.
  const subjectLabel = (a: TeachingAssignment) =>
    a.shortCode || subjects.find((s) => s.id === a.subjectId)?.shortCode || readableCode(a.subjectCode, a.subjectName) || a.subjectName;
  const rows = timing ? buildRows(timing) : [];
  // Which period cells of a day are drawn as one wide cell (the ones merged via "Merge cells").
  const spansFor = (d: DayOfWeek) =>
    continuousSpans(
      rows.map((r) => (r.kind === "period" ? { kind: "period", periodNumber: r.period } : { kind: "break" })),
      (p) => cellEntriesFor(d, p).map((e) => e.slot) as TimetableSlot[],
    );

  function toggleMergePick(d: DayOfWeek, firstPeriod: number, span: number) {
    const covered = Array.from({ length: span }, (_, i) => firstPeriod + i);
    setMergePick((p) => {
      if (p.day !== d) return { day: d, periods: covered };
      const has = covered.every((x) => p.periods.includes(x));
      return {
        day: d,
        periods: has
          ? p.periods.filter((x) => !covered.includes(x))
          : Array.from(new Set([...p.periods, ...covered])).sort((a, b) => a - b),
      };
    });
  }

  async function patchMerge(action: "merge" | "unmerge", day: DayOfWeek, assignmentId: string, from: number, to: number): Promise<boolean> {
    const res = await fetch("/api/college/timetable/draft", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, ...semesterBody, action, assignmentId, fromDay: day, fromPeriod: from, toPeriod: to }),
    });
    const json = (await res.json()) as { slots?: DraftSlot[]; error?: string };
    if (!res.ok) {
      toast({ variant: "destructive", title: action === "merge" ? "Could not merge" : "Could not unmerge", description: json.error });
      return false;
    }
    setDraft((dr) => (dr ? { ...dr, slots: json.slots ?? dr.slots, status: "DRAFT" } : dr));
    return true;
  }

  async function handleMergeAction(action: "merge" | "unmerge") {
    const { day, periods } = mergePick;
    const sorted = [...periods].sort((a, b) => a - b);
    const idxOf = (p: number) => rows.findIndex((r) => r.kind === "period" && r.period === p);
    // A draft (not pinned) entry of the cell - the API anchors on a draft slot.
    const draftAssignmentAt = (p: number) => cellEntriesFor(day, p).find((e) => !e.isPinned)?.slot.assignmentId;
    setBusy("move");
    try {
      if (action === "merge") {
        // Back-to-back period columns only: a break column in between ends a run.
        if (sorted.length < 2 || sorted.some((p, i) => i > 0 && idxOf(p) !== idxOf(sorted[i - 1]) + 1)) {
          toast({ variant: "destructive", title: "Pick back-to-back periods", description: "Select two or more adjacent periods on the same day (not across a break)." });
          return;
        }
        const aid = draftAssignmentAt(sorted[0]);
        if (!aid) { toast({ variant: "destructive", title: "Pinned periods can't be merged" }); return; }
        if (!(await patchMerge("merge", day, aid, sorted[0], sorted[sorted.length - 1]))) return;
        toast({ variant: "success", title: "Cells merged", description: "Shown as one cell once published." });
      } else {
        // Undo every merged cell among the selection (each starts at its first period).
        const { spans } = spansFor(day);
        let any = false;
        for (const p of sorted) {
          const span = spans.get(idxOf(p)) ?? 1;
          if (span < 2) continue;
          const aid = draftAssignmentAt(p);
          if (!aid) continue;
          any = true;
          if (!(await patchMerge("unmerge", day, aid, p, p + span - 1))) return;
        }
        if (!any) { toast({ title: "Nothing to unmerge", description: "Select a merged cell." }); return; }
        toast({ variant: "success", title: "Cells unmerged" });
      }
      setMergePick({ day, periods: [] });
    } finally {
      setBusy(null);
    }
  }
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
  //
  // A section the sections API marks "primary" is one this HOD owns for this
  // year - including a managed branch's shared-year section (e.g. a Basic
  // Science sub-HOD running Mechanical's 1st year) - so it is theirs to publish,
  // exactly as the publish route already allows (canHodEditDepartment).
  const ownsSectionYear = section?.accessLevel === "primary";
  const isCrossDepartment = !isLoading && (!section || (!ownsSectionYear && myDepartments.length > 0 && !myDepartments.includes(section.department)));
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
  // Pinned periods (placed straight onto the live timetable, outside any draft) would show locked and
  // could not be moved or removed here. Pressing Edit moves them into the draft as ordinary periods,
  // once per edit session; the banner below does the same on demand. See api/college/timetable/unpin.
  const pinnedCount = slots.filter((x) => x.source !== "GENERATED").length;
  const [unlocking, setUnlocking] = useState(false);
  const unlockPinned = useCallback(async (quiet: boolean) => {
    setUnlocking(true);
    try {
      const res = await fetch("/api/college/timetable/unpin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, ...semesterBody }),
      });
      const json = (await res.json().catch(() => ({}))) as { unlocked?: number; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not unlock the pinned periods", description: json.error });
        return;
      }
      if ((json.unlocked ?? 0) > 0) {
        toast({ title: `${json.unlocked} pinned period${json.unlocked === 1 ? "" : "s"} unlocked`, description: "They can now be moved or removed like any other." });
        await loadAll();
      } else if (!quiet) {
        toast({ title: "Nothing to unlock", description: "None of the pinned periods belong to the current semester." });
      }
    } catch {
      toast({ variant: "destructive", title: "Could not unlock the pinned periods" });
    } finally {
      setUnlocking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, semesterQuery, loadAll]);
  const unlockTriedRef = useRef(false);
  useEffect(() => {
    if (!isEditing) { unlockTriedRef.current = false; return; }
    if (mode !== "draft" || isCrossDepartment || !draft || unlockTriedRef.current || pinnedCount === 0) return;
    unlockTriedRef.current = true;
    void unlockPinned(true);
  }, [isEditing, mode, isCrossDepartment, draft, pinnedCount, unlockPinned]);

  // A lent-in subject is held back only while nobody has placed it: one already on the timetable
  // (draft or published) stays editable, whatever the lender's close state.
  const placedAssignmentIds = new Set([...(draft?.slots ?? []).map((x) => x.assignmentId), ...slots.map((x) => x.assignmentId)]);
  const heldBack = (id: string) => notReadyLentInIds.has(id) && !placedAssignmentIds.has(id);
  const myAssignmentIds = isCrossDepartment
    ? fulfillingAssignmentId
      ? [fulfillingAssignmentId]
      : assignments
          .filter((a) => (myFacultyIds.has(a.facultyId) || lentInAssignmentIds.has(a.id)) && !heldBack(a.id))
          .map((a) => a.id)
    : assignments.filter((a) => !heldBack(a.id)).map((a) => a.id);
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
  // Subjects already in the clicked cell: another faculty of the SAME subject may join it
  // (co-teaching, theory or lab); any other join must be a lab alongside a lab.
  const occupantSubjectIds = new Set(addingAt ? rawCellEntriesFor(addingAt.day, addingAt.period).map((e) => e.slot.subjectId) : []);
  // A different lab can only join a period that holds labs alone; a theory period only takes more faculty of its own subject.
  const occupantsAllLabs = addingAt
    ? rawCellEntriesFor(addingAt.day, addingAt.period).every((e) => assignments.find((a) => a.id === e.slot.assignmentId)?.subjectType === "PRACTICAL")
    : false;
  const pickableAssignments = assignments.filter(
    (a) => myAssignmentIds.includes(a.id) && !occupyingAtTarget.has(a.id)
      && (!isSplitTarget || occupantSubjectIds.has(a.subjectId) || (a.subjectType === "PRACTICAL" && occupantsAllLabs))
  );
  // Lent-in subjects not offered yet (their lender has not closed the request and nothing is placed).
  const heldBackList = assignments.filter((a) => heldBack(a.id) && !a.isPast);
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
  /**
   * Several faculty of ONE subject in the same cell (co-teaching): the subject is shown once, with
   * each faculty listed under it. Clicking a faculty selects just their placement, so move/remove
   * still act on one person at a time.
   */
  function renderSharedCell(mates: { slot: TimetableSlot | DraftSlot; isPinned: boolean }[]) {
    const first = mates[0].slot;
    const code = ("subjectCode" in first && first.subjectCode) || ("shortCode" in first && (first as unknown as { shortCode?: string }).shortCode) || first.subjectName;
    const allLocked = mates.every((m) => m.isPinned || (isCrossDepartment && mode === "draft" && !myAssignmentIds.includes((m.slot as DraftSlot).assignmentId)));
    return (
      <div
        key={`shared_${first.subjectId}`}
        className={`w-full rounded-md border p-2 ${allLocked ? "bg-muted border-border" : cellTint(first.assignmentId)}`}
      >
        <p className="text-xs font-bold leading-tight uppercase tracking-wide">{code}</p>
        {("subjectCode" in first && first.subjectCode && first.subjectCode !== first.subjectName) && (
          <p className="mt-0.5 line-clamp-1 text-[10px] font-medium text-muted-foreground" title={first.subjectName}>{first.subjectName}</p>
        )}
        <div className="mt-1 space-y-0.5">
          {mates.map((m, i) => {
            const { slot, isPinned } = m;
            const dSlot = !isPinned && mode === "draft" ? (slot as DraftSlot) : undefined;
            // A subject that is not the viewer's own is locked only for someone from ANOTHER department;
            // the section's own HOD / Incharge can move or remove every period of it.
            const isForeignSlot = isCrossDepartment && Boolean(dSlot) && !myAssignmentIds.includes(dSlot!.assignmentId);
            const isLocked = isPinned || isForeignSlot;
            const clickable = mode === "draft" && isEditing && (!isLocked || !isCrossDepartment);
            const isSelected = !!(selected && dSlot && selected.assignmentId === dSlot.assignmentId
              && selected.day === dSlot.day && selected.periodNumber === dSlot.periodNumber);
            const covering = "substituteFacultyName" in slot ? slot.substituteFacultyName : undefined;
            return (
              <div key={`${slot.assignmentId}_${i}`}>
                <button
                  type="button"
                  disabled={!clickable || busy !== null}
                  onClick={() => { if (clickable && dSlot) setSelected(isSelected ? null : dSlot); }}
                  className={[
                    "block w-full rounded px-1 py-0.5 text-left text-[11px] transition-colors",
                    isSelected ? "bg-primary/15 font-semibold ring-1 ring-primary" : "text-muted-foreground",
                    clickable ? "cursor-pointer hover:bg-primary/10" : "cursor-default",
                  ].join(" ")}
                >
                  {covering ? <span className="font-medium text-amber-700">{covering}</span> : slot.facultyName}
                </button>
                {isSelected && dSlot && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void handleRemove(dSlot); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void handleRemove(dSlot); } }}
                    className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />Remove {slot.facultyName}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function cellEntriesFor(day: DayOfWeek, period: number): { slot: TimetableSlot | DraftSlot; isPinned: boolean }[] {
    const entries = rawCellEntriesFor(day, period);
    return typeFilter === "ALL" ? entries : entries.filter((e) => e.slot.subjectType === typeFilter);
  }

  /** Starts an empty draft so the whole timetable can be built by hand. */
  async function handleStartBlank() {
    setBusy("blank");
    try {
      const res = await fetch("/api/college/timetable/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, ...semesterBody }),
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

  /**
   * PATCHes one teaching assignment into the clicked cell. `coTeach`: it joins the SAME subject
   * already in the cell (another faculty of it); `allowSplit`: it joins a different lab.
   * Returns an error message, or null once placed.
   */
  async function placeOne(assignment: TeachingAssignment, flags: { coTeach: boolean; allowSplit: boolean }): Promise<string | null> {
    if (!addingAt) return "No cell selected";
    const res = await fetch("/api/college/timetable/draft", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionId,
        ...semesterBody,
        action: "add",
        assignmentId: assignment.id,
        toDay: addingAt.day,
        toPeriod: addingAt.period,
        allowSplit: flags.allowSplit,
        ...(flags.coTeach ? { coTeach: true } : {}),
      }),
    });
    const json = (await res.json()) as { slots?: DraftSlot[]; error?: string; adjustedNote?: string | null };
    if (!res.ok) return json.error ?? "Cannot add here";
    setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
    if (json.adjustedNote) toast({ title: "Lab spans a break", description: json.adjustedNote });
    return null;
  }

  /** The flags the FIRST faculty placed in the clicked cell needs, from what the cell already holds. */
  function flagsForCell(assignment: TeachingAssignment) {
    const sameSubjectHere = isSplitTarget && occupantSubjectIds.has(assignment.subjectId);
    return { coTeach: sameSubjectHere, allowSplit: isSplitTarget && !sameSubjectHere };
  }

  /** Picked a subject in the "Add a subject" list. A subject with other faculty in this section asks first. */
  function handleAdd(assignment: TeachingAssignment) {
    if (!addingAt) return;
    const others = assignments.filter(
      (x) => x.id !== assignment.id && x.subjectId === assignment.subjectId && !x.isPast
        && myAssignmentIds.includes(x.id) && !occupyingAtTarget.has(x.id),
    );
    if (others.length > 0) {
      setSharePrompt({ picked: assignment, others });
      return;
    }
    void placeAssignments([assignment]);
  }

  /** Places the given faculty of one subject in the clicked cell, the first as the cell allows and the rest alongside it. */
  async function placeAssignments(list: TeachingAssignment[]) {
    if (!addingAt || list.length === 0) return;
    setBusy("move");
    try {
      for (let i = 0; i < list.length; i++) {
        const flags = i === 0 ? flagsForCell(list[i]) : { coTeach: true, allowSplit: false };
        const problem = await placeOne(list[i], flags);
        if (problem) {
          toast({
            variant: "destructive",
            title: i === 0 ? "Cannot add here" : `Placed ${list.slice(0, i).map((a) => a.facultyName).join(", ")}, but not ${list[i].facultyName}`,
            description: problem,
          });
          if (i > 0) setAddingAt(null);
          return;
        }
      }
      setAddingAt(null);
    } finally {
      setBusy(null);
      setSharePrompt(null);
    }
  }

  /** Deletes one pinned (live, manually placed) period. A pinned lab block is one slot per period, so each is removed on its own. */
  async function handleRemovePinned(slotId: string, subjectName: string) {
    if (!window.confirm(`Remove the pinned period for ${subjectName}? This changes the live timetable immediately.`)) return;
    setBusy("move");
    try {
      const res = await fetch(`/api/college/timetable-slots/${encodeURIComponent(slotId)}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ variant: "destructive", title: "Could not remove", description: json.error });
        return;
      }
      setSlots((prev) => prev.filter((x) => (x as TimetableSlot & { id?: string }).id !== slotId));
      toast({ title: "Pinned period removed" });
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
          ...semesterBody,
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
        body: JSON.stringify({ sectionId, effectiveDate, ...semesterBody }),
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
      const res = await fetch(`/api/college/timetable/draft?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`, { method: "DELETE" });
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

  // Deletes the section's whole timetable - published slots, draft and the
  // teaching assignments behind them - so Teaching Assignments and every
  // faculty's Teaching Load start fresh.
  async function handleReset() {
    setBusy("reset");
    try {
      const res = await fetch(`/api/college/timetable/reset?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; removedAssignments?: number; removedSlots?: number };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Could not delete the timetable" });
        return;
      }
      toast({
        variant: "success",
        title: "Timetable deleted",
        description: `${json.removedAssignments ?? 0} teaching assignment(s) and ${json.removedSlots ?? 0} period(s) removed.`,
      });
      setIsEditing(false);
      setSelected(null);
      await loadAll();
      setModeState("published");
    } finally {
      setBusy(null);
      setConfirmReset(false);
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
          ...semesterBody,
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

  // `Section.department` is the department NAME string (see the join-key comment
  // on POST college/departments), so it is already printable - no name lookup
  // round-trip is needed for the header.
  const departmentName = section?.department;


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
                {courseYearNumbers(course?.durationYears ?? Math.max(0, ...allTimings.map((t) => Number(t.year) || 0))).map((y) => {
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

      {/* History tab removed from this editor: the view is always the live timetable. */}
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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-1.5" />Delete entire timetable
              </Button>
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
              {isEditing && (!mergeMode ? (
                <Button size="sm" variant="outline" onClick={() => { setMergeMode(true); setSelected(null); setMergePick({ day: "MON", periods: [] }); }}>
                  Merge cells
                </Button>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    Click the cells to merge{mergePick.periods.length > 0 ? ` (${mergePick.periods.length} selected)` : ""}
                  </span>
                  <Button size="sm" onClick={() => void handleMergeAction("merge")} disabled={busy !== null || mergePick.periods.length < 2}>
                    Merge selected
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleMergeAction("unmerge")} disabled={busy !== null || mergePick.periods.length < 1}>
                    Unmerge selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setMergeMode(false); setMergePick({ day: "MON", periods: [] }); }}>
                    Done
                  </Button>
                </>
              ))}
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
              {!isCrossDepartment && (
                <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4 mr-1.5" />Delete entire timetable
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
            : "Click an empty period to add a subject, or a placed subject to move or remove it. Subjects lent in by another department are changed by that department, not here."}
        </p>
      )}

      {mode === "draft" && isEditing && !isCrossDepartment && pinnedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>{pinnedCount} period{pinnedCount === 1 ? " is" : "s are"} pinned on the live timetable and locked here.</span>
          <Button size="sm" variant="outline" loading={unlocking} onClick={() => void unlockPinned(false)}>
            Unlock {pinnedCount === 1 ? "it" : "them"}
          </Button>
        </div>
      )}

      {mode === "draft" && isEditing && assignments.length > 0 && (
        <div className="space-y-1.5 rounded-md border p-3">
          <p className="text-xs font-semibold">Subject colors</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              className="h-8 min-w-[180px] rounded-md border bg-background px-2 text-xs"
              value={colorPickId}
              onChange={(e) => setColorPickId(e.target.value)}
              aria-label="Subject"
            >
              <option value="">Select subject</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {subjectLabel(a)}{a.sectionName ? ` · ${a.sectionName}` : ""}
                </option>
              ))}
            </select>
            {(Object.keys(SUBJECT_COLORS) as (keyof typeof SUBJECT_COLORS)[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-label={`Colour ${k}`}
                onClick={() => setColorPickColor(k)}
                className={`h-5 w-5 rounded-full ${SUBJECT_COLORS[k].dot} ${colorPickColor === k ? "ring-2 ring-primary ring-offset-1" : ""}`}
              />
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={!colorPickId || !colorPickColor}
              onClick={() => { if (colorPickId && colorPickColor) { void setCellColor(colorPickId, colorPickColor); setColorPickId(""); } }}
            >
              Add
            </Button>
          </div>
          {/* Only subjects that already have a colour are listed. */}
          {assignments.filter((a) => a.cellColor).map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <span className={`h-4 w-4 rounded-full ${isSubjectColor(a.cellColor) ? SUBJECT_COLORS[a.cellColor].dot : ""}`} />
              <span className="min-w-[120px] font-medium">{subjectLabel(a)}</span>
              <button type="button" className="text-muted-foreground underline" onClick={() => void setCellColor(a.id, null)}>
                Remove
              </button>
            </div>
          ))}
        </div>
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
        <div className="overflow-x-auto md:overflow-x-visible rounded-lg border">
          <table className="w-full text-xs md:table-fixed border-collapse">
            <colgroup>
              <col style={{ width: "60px" }} />
              {rows.map((row, idx) => (
                <col
                  key={row.kind === "period" ? `p_${row.period}` : `b_${idx}`}
                  style={{ width: row.kind === "period" ? "auto" : "40px" }}
                />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2 text-center font-bold text-foreground border-b w-[60px] sticky left-0 z-[5] bg-muted/95 backdrop-blur">
                  Day
                </th>
                {rows.map((row, idx) => {
                  if (row.kind === "lunch" || row.kind === "short") {
                    const label = row.kind === "lunch" ? "L" : "B";
                    return (
                      <th key={`break_${idx}`} className="p-1 text-center font-medium border-b bg-amber-50/60 w-[40px]">
                        <span className="flex flex-col items-center gap-0.5 text-amber-700">
                          <span className="text-[10px] font-bold uppercase">{label}</span>
                          <span className="text-[8.5px] font-normal text-amber-700/80">{row.durationMinutes}m</span>
                        </span>
                      </th>
                    );
                  }
                  return (
                    <th key={`period_${row.period}`} className="p-1.5 text-center font-bold text-muted-foreground border-b">
                      <div>P{row.period}</div>
                      {row.startTime && row.endTime && (
                        <p className="text-[9px] font-normal truncate mt-0.5" title={`${formatTime12h(row.startTime)}–${formatTime12h(row.endTime)}`}>
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
                    const { spans, skipped } = spansFor(d);
                    // Swallowed by the wider cell to its left.
                    if (skipped.has(idx)) return null;
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
                    // ...or another faculty of the same subject that is not in the cell yet (co-teaching).
                    // (counted by subject: a lab with two faculty is still one lab, so a second lab may join it)
                    const labCanSplit = new Set(rawEntries.map((e) => e.slot.subjectId)).size < 2
                      && rawEntries.every((e) => assignments.find((a) => a.id === e.slot.assignmentId)?.subjectType === "PRACTICAL");
                    const sameSubjectFacultyLeft = assignments.some((a) =>
                      myAssignmentIds.includes(a.id) && !a.isPast
                      && !rawEntries.some((e) => e.slot.assignmentId === a.id)
                      && rawEntries.some((e) => e.slot.subjectId === a.subjectId));
                    // Always offered on an occupied period while editing: the dialog lists what can join (another lab beside a
                    // lab, or another faculty of the same subject) and says why when nothing can.
                    const canAddAnother = mode === "draft" && isEditing;

                    return (
                      <td
                        key={`period_${row.period}`}
                        colSpan={spans.get(idx) ?? 1}
                        // In "Merge cells" mode a click on an occupied cell picks it for merging.
                        onClick={mergeMode && isEditing && entries.length > 0 ? () => toggleMergePick(d, row.period, spans.get(idx) ?? 1) : undefined}
                        className={[
                          "p-2 align-top",
                          mergeMode && entries.length > 0 ? "cursor-pointer" : "",
                          mergeMode && mergePick.day === d && Array.from({ length: spans.get(idx) ?? 1 }, (_, i) => row.period + i).every((x) => mergePick.periods.includes(x))
                            ? "bg-primary/15 ring-2 ring-inset ring-primary" : "",
                        ].join(" ")}
                      >
                        <div className={mergeMode ? "space-y-1 pointer-events-none" : "space-y-1"}>
                            {entries.map((entry, entryIdx) => {
                              // Faculty of one subject sharing this cell: one block, subject once.
                              const sameSubject = entries.filter((e) => e.slot.subjectId === entry.slot.subjectId);
                              if (sameSubject.length > 1) {
                                if (entries.findIndex((e) => e.slot.subjectId === entry.slot.subjectId) !== entryIdx) return null;
                                return renderSharedCell(sameSubject);
                              }
                              const { slot, isPinned } = entry;
                              const dSlot = !isPinned && mode === "draft" ? (slot as DraftSlot) : undefined;
                              // A placed period this HOD doesn't own (e.g. a subject lent in
                              // through a cross-department Assignment Request) is shown same as
                              // a pinned slot - visible, but locked against move/remove here.
                              const isForeignSlot = isCrossDepartment && Boolean(dSlot) && !myAssignmentIds.includes(dSlot!.assignmentId);
                              const isLocked = isPinned || isForeignSlot;
                              const isSelected =
                                selected && dSlot &&
                                selected.assignmentId === dSlot.assignmentId &&
                                selected.day === dSlot.day &&
                                selected.periodNumber === dSlot.periodNumber;
                              // The section's own HOD may select (and so remove) a placement locked only
                              // because its teaching assignment no longer exists - otherwise those stale
                              // cells could never be cleared short of discarding the whole draft - and may
                              // remove a pinned (live, manually placed) slot. Anyone else's slot seen
                              // cross-department stays locked.
                              const clickable = mode === "draft" && isEditing && (!isLocked || !isCrossDepartment);
                              const pinnedId = isPinned && !isCrossDepartment ? (slot as TimetableSlot & { id?: string }).id : undefined;
                              const substituteFacultyName = "substituteFacultyName" in slot ? slot.substituteFacultyName : undefined;

                              return (
                                <button
                                  // A split lab period holds several entries of ONE assignment in a cell.
                                  key={`${slot.assignmentId}_${entryIdx}`}
                                  type="button"
                                  disabled={!clickable || busy !== null}
                                  onClick={() => {
                                    if (!clickable || !dSlot) return;
                                    setSelected(isSelected ? null : dSlot);
                                  }}
                                  className={[
                                    "w-full text-left rounded-md border p-2 transition-colors",
                                    isLocked
                                      ? "bg-muted border-border"
                                      : cellTint(slot.assignmentId),
                                    isSelected ? "ring-2 ring-primary" : "",
                                    clickable ? "hover:border-primary cursor-pointer" : "cursor-default",
                                  ].join(" ")}
                                >
                                  <p className="text-xs font-bold leading-tight flex items-center gap-1 uppercase tracking-wide">
                                    {isLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                    {("subjectCode" in slot && readableCode(slot.subjectCode, slot.subjectName)) || ("shortCode" in slot && (slot as unknown as { shortCode?: string }).shortCode) || slot.subjectName}
                                  </p>
                                  {("subjectCode" in slot && readableCode(slot.subjectCode, slot.subjectName) && readableCode(slot.subjectCode, slot.subjectName) !== slot.subjectName) && (
                                    <p className="text-[10px] font-medium text-muted-foreground line-clamp-1 mt-0.5" title={slot.subjectName}>
                                      {slot.subjectName}
                                    </p>
                                  )}
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
                                  {/* Why this period is locked. */}
                                  {isLocked && (
                                    <p className="mt-1 text-[10px] font-medium text-amber-700">
                                      {isPinned
                                        ? "Pinned on the live timetable"
                                        : notReadyLentInIds.get(slot.assignmentId)
                                          ? `Lent in - waiting for ${notReadyLentInIds.get(slot.assignmentId)}`
                                          : "Belongs to another department"}
                                    </p>
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
                                  {pinnedId && mode === "draft" && isEditing && (
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => { e.stopPropagation(); void handleRemovePinned(pinnedId, slot.subjectName); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault(); e.stopPropagation(); void handleRemovePinned(pinnedId, slot.subjectName);
                                        }
                                      }}
                                      className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-3 w-3" />Remove pinned
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
                                onClick={() => { setSelected(null); setAddingAt({ day: d, period: row.period }); }}
                                className="w-full rounded-md border border-dashed p-1 text-center text-[10px] text-muted-foreground hover:border-primary hover:text-primary cursor-pointer"
                              >
                                <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />{sameSubjectFacultyLeft && !labCanSplit ? "Add faculty" : "Split - add subject"}</span>
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
                ? `This period already has a subject - another faculty of the same subject, or a lab (Practical) subject alongside a lab, can be added to it.`
                : `Pick a subject assigned to this section. Its faculty comes along automatically; a subject with custom continuous slots (set in Settings) takes that many periods.`}
            </DialogDescription>
          </DialogHeader>

          {pickableAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isSplitTarget
                ? "None of your remaining lab (Practical) subjects can be added here - only a lab may share an already-occupied period."
                : isCrossDepartment
                  ? "None of your faculty are assigned to this section yet. Add that under Teaching Assignments first."
                  : heldBackList.length > 0
                    ? "The remaining subjects are lent in by other departments, which have not finished yet - see below."
                    : assignments.length > 0
                      ? "Every remaining subject is already placed in this period, or none of them can go here."
                      : "No subjects are assigned to this section yet. Add them under Teaching Assignments first."}
            </p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {pickableAssignments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleAdd(a)}
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

          {/* Subjects lent in by another department stay out of the list above until that department
              has shared the faculty's busy periods and pressed "Notify department & close". */}
          {heldBackList.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">Not available yet - waiting for the lending department</p>
              {heldBackList.map((a) => (
                <p key={a.id} className="text-xs text-amber-900">
                  {a.subjectName} - {a.facultyName}
                  <span className="text-amber-700"> · waiting for {notReadyLentInIds.get(a.id)} to notify you</span>
                </p>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* A subject with more than one faculty: all of them in this cell together (co-teaching), or only the one picked. */}
      <Dialog open={sharePrompt !== null} onOpenChange={(o) => { if (!o && busy === null) setSharePrompt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{sharePrompt?.picked.subjectName} has more than one faculty</DialogTitle>
            <DialogDescription>
              {sharePrompt
                ? `${[sharePrompt.picked, ...sharePrompt.others].map((a) => a.facultyName).join(", ")} teach this subject in this section. Place them all in this period, or add ${sharePrompt.picked.facultyName} alone here and add the others in other periods?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              loading={busy !== null}
              onClick={() => sharePrompt && void placeAssignments([sharePrompt.picked, ...sharePrompt.others])}
            >
              Place all {sharePrompt ? 1 + sharePrompt.others.length : ""} faculty here
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => sharePrompt && void placeAssignments([sharePrompt.picked])}
            >
              Only {sharePrompt?.picked.facultyName} here - add the others separately
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setSharePrompt(null)}>Cancel</Button>
          </div>
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
        confirmDisabled={!isCrossDepartment && !effectiveDate}
        onConfirm={handlePublish}
      >
        {!isCrossDepartment && (
          <div className="space-y-1.5">
            <Label htmlFor="publish-wef">Effective from (w.e.f)</Label>
            <Input id="publish-wef" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Printed on the timetable&apos;s title line.</p>
          </div>
        )}
      </ConfirmDialog>
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
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Delete the entire timetable?"
        description="This removes the published timetable, the draft every teaching assignment for this section and semester, and its open assignment requests, so Teaching Assignments and each faculty's Teaching Load start fresh. This cannot be undone."
        confirmLabel="Delete everything"
        variant="destructive"
        loading={busy === "reset"}
        onConfirm={handleReset}
      />
      </>
    </div>
  );
}
