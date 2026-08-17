"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Coffee, Lock, PencilLine, Plus, Send, Trash2, Upload, Utensils, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { buildRows } from "@/lib/timetable/buildGrid";
import type {
  Course, Section, CourseYearTiming, TimetableSlot, DayOfWeek, DraftSlot, TimetableDraft,
  TeachingAssignment, FacultyAssignmentRequest,
} from "@/types";
import { DAY_LABELS, DEFAULT_TIMETABLE_RULES } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** What the grid is currently showing. */
type Mode = "published" | "draft";

export default function HODTimetableGridPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();
  const searchParams = useSearchParams();
  // A lending HOD placing an allocated cross-department assignment (see
  // Assignment Requests) is viewing a section outside their own department -
  // /api/college/courses is scoped to the viewer's own department, so
  // `course` below resolves to null for them even though the grid itself
  // (timing/slots/draft/assignments, all looked up directly by id) works
  // fine. These carry the name through from the request they fulfilled,
  // purely as a title fallback.
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
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [draft, setDraft] = useState<TimetableDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [modeState, setModeState] = useState<Mode>("published");
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
  // Assignment ids on this section that were created by fulfilling a
  // cross-department Assignment Request (cross-referenced via
  // facultyAssignmentRequests.teachingAssignmentId, not by comparing faculty
  // departments - a feeder like Basic Science can legitimately share its
  // faculty with every department it feeds, so "faculty belongs to a
  // different department" alone isn't a reliable signal). The lending HOD
  // places these periods themselves from their own cross-department view of
  // this same page, so myAssignmentIds/pickableAssignments below exclude them
  // here regardless of who's currently viewing this section.
  const [lentInAssignmentIds, setLentInAssignmentIds] = useState<Set<string>>(new Set());

  const days: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const loadAll = useCallback(async () => {
    try {
      const [coursesData, sectionsData, timingsData, slotsData, draftData, assignData, facultyData, requestsData] = await Promise.all([
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
          .then((r) => r.json() as Promise<{ sections: Section[] }>),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
          .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ slots: TimetableSlot[] }>),
        fetch(`/api/college/timetable/draft?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ draft: TimetableDraft | null }>),
        fetch(`/api/college/teaching-assignments?sectionId=${encodeURIComponent(sectionId)}`)
          .then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>),
        fetch("/api/college/faculty?status=ACTIVE")
          .then((r) => r.json() as Promise<{ faculty: { id: string; accessLevel?: string }[] }>),
        fetch("/api/college/faculty-assignment-requests")
          .then((r) => r.json() as Promise<{ requests: FacultyAssignmentRequest[] }>),
      ]);

      setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
      setSection((sectionsData.sections ?? []).find((s) => s.id === sectionId) ?? null);
      setTiming((timingsData.timings ?? []).find((t) => t.year === Number(year)) ?? null);
      setSlots(slotsData.slots ?? []);
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
  // so "Publish" reads as "Update" - see handlePublish.
  const isCrossDepartment = !isLoading && (!section || (!!user?.department && section.department !== user.department));
  // A cross-department contributor never publishes this section themselves
  // (see handleNotify/handlePublish below and the server-side guard in
  // /api/college/timetable/publish) - so there's nothing for them to "view
  // published" either. Derived rather than a synced effect, so it can never
  // flash the wrong toggle state: always draft for them, never "Published".
  const mode: Mode = isCrossDepartment ? "draft" : modeState;
  // Which assignments on this section this HOD may actually place/move/remove
  // periods for - both here and in the "Add a subject" picker below, so
  // "Update"/"Publish" only ever touches their own subjects. Cross-department:
  // their own faculty's assignments, regardless of whether they arrived via a
  // specific "Place on timetable" link (fulfillingAssignmentId) or navigated
  // here directly (e.g. a BS sub-HOD opening a CSE section they manage
  // straight from the sidebar). Own section: everything except a subject lent
  // in through a cross-department Assignment Request (lentInAssignmentIds) -
  // the lending HOD manages its periods from their own cross-department view
  // of this same page, so this HOD can see it on the grid but not touch it.
  const myAssignmentIds = isCrossDepartment
    ? Array.from(new Set([
        ...assignments.filter((a) => myFacultyIds.has(a.facultyId)).map((a) => a.id),
        ...(fulfillingAssignmentId ? [fulfillingAssignmentId] : []),
      ]))
    : assignments.filter((a) => !lentInAssignmentIds.has(a.id)).map((a) => a.id);
  // Same restriction, applied to the "Add a subject" picker.
  const pickableAssignments = assignments.filter((a) => myAssignmentIds.includes(a.id));
  const draftHasSlots = Boolean(draft?.slots?.length);
  // Gates the Update button specifically: having *some* slots in the draft
  // isn't enough if none of them are this HOD's own faculty's yet.
  const myDraftHasSlots = isCrossDepartment
    ? (draft?.slots ?? []).some((s) => myAssignmentIds.includes(s.assignmentId))
    : draftHasSlots;
  const draftIsUnpublished = draft?.status === "DRAFT";

  function publishedSlotFor(day: DayOfWeek, period: number) {
    return slots.find((s) => s.day === day && s.periodNumber === period);
  }
  function draftSlotFor(day: DayOfWeek, period: number) {
    return draft?.slots.find((s) => s.day === day && s.periodNumber === period);
  }
  /** Pinned slots stay visible in draft mode - the generator scheduled around them. */
  function pinnedSlotFor(day: DayOfWeek, period: number) {
    return slots.find((s) => s.day === day && s.periodNumber === period && s.source !== "GENERATED");
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
      const res = await fetch("/api/college/timetable/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          action: "add",
          assignmentId: assignment.id,
          toDay: addingAt.day,
          toPeriod: addingAt.period,
        }),
      });
      const json = (await res.json()) as { slots?: DraftSlot[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Cannot add here", description: json.error });
        return;
      }
      setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
      setAddingAt(null);
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
      const json = (await res.json()) as { slots?: DraftSlot[]; error?: string };
      if (!res.ok) {
        // The server refuses moves that would break a hard constraint, and says why.
        toast({ variant: "destructive", title: "Cannot move here", description: json.error });
        return;
      }
      setDraft((d) => (d ? { ...d, slots: json.slots ?? d.slots, status: "DRAFT" } : d));
      setSelected(null);
    } finally {
      setBusy(null);
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
            <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}/${year}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            {/* Manual route: an HOD can always build a timetable by hand -
                kept available cross-department too, since a lending HOD may
                be the first to touch this section's timetable at all and
                needs somewhere to click. */}
            {!hasDraft && (
              <Button variant="outline" onClick={handleStartBlank} loading={busy === "blank"} disabled={busy !== null}>
                <PencilLine className="h-4 w-4 mr-2" />Build manually
              </Button>
            )}
          </div>
        }
      />

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

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(Number(year))} yet. Ask the Principal to set them up under Departments first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {days.map((d) => (
                  <th key={d} className="p-2.5 text-left font-medium text-muted-foreground border-b min-w-35">
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === "lunch" || row.kind === "short") {
                  const Icon = row.kind === "lunch" ? Utensils : Coffee;
                  const label = row.kind === "lunch" ? "Lunch Break" : "Short Break";
                  return (
                    <tr key={`break_${idx}`} className="bg-amber-50/60">
                      <td colSpan={days.length + 1} className="p-2 text-center text-xs font-medium text-amber-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" />
                          {label} · {row.durationMinutes} min
                        </span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={`period_${row.period}`} className="border-b last:border-b-0">
                    <td className="p-2.5 font-medium text-muted-foreground">{row.period}</td>
                    {days.map((d) => {
                      const pinned = mode === "draft" ? pinnedSlotFor(d, row.period) : undefined;
                      const dSlot = mode === "draft" ? draftSlotFor(d, row.period) : undefined;
                      const pSlot = mode === "published" ? publishedSlotFor(d, row.period) : undefined;
                      const slot = pinned ?? dSlot ?? pSlot;
                      // A placed period this HOD doesn't own (e.g. a subject lent in
                      // through a cross-department Assignment Request) is shown same as
                      // a pinned slot - visible, but locked against move/remove here.
                      const isForeignSlot = Boolean(dSlot) && !myAssignmentIds.includes(dSlot!.assignmentId);
                      const isPinnedCell = Boolean(pinned) || isForeignSlot || (mode === "published" && pSlot?.source !== "GENERATED" && pSlot !== undefined);
                      const isSelected =
                        selected && dSlot &&
                        selected.assignmentId === dSlot.assignmentId &&
                        selected.day === dSlot.day &&
                        selected.periodNumber === dSlot.periodNumber;

                      const clickable = mode === "draft" && isEditing && !pinned && !isForeignSlot;

                      return (
                        <td key={d} className="p-2 align-top">
                          {slot ? (
                            <button
                              type="button"
                              disabled={!clickable || busy !== null}
                              onClick={() => {
                                if (!clickable || !dSlot) return;
                                setSelected(isSelected ? null : dSlot);
                              }}
                              className={[
                                "w-full text-left rounded-md border p-2 transition-colors",
                                isPinnedCell
                                  ? "bg-muted border-border"
                                  : "bg-primary/5 border-primary/20",
                                isSelected ? "ring-2 ring-primary" : "",
                                clickable ? "hover:border-primary cursor-pointer" : "cursor-default",
                              ].join(" ")}
                            >
                              <p className="text-xs font-semibold leading-tight flex items-center gap-1">
                                {isPinnedCell && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                {slot.subjectName}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
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
                          ) : (
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
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
              Pick a subject assigned to this section. Its faculty comes along automatically;
              labs take {DEFAULT_TIMETABLE_RULES.labBlockSize} continuous periods.
            </DialogDescription>
          </DialogHeader>

          {pickableAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isCrossDepartment
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
    </div>
  );
}
