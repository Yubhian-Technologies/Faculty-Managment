"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Coffee, Lock, PencilLine, Plus, Trash2, Upload, Utensils, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { buildRows } from "@/lib/timetable/buildGrid";
import type {
  Course, Section, CourseYearTiming, TimetableSlot, DayOfWeek, DraftSlot, TimetableDraft,
  TeachingAssignment,
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
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();

  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [draft, setDraft] = useState<TimetableDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [mode, setMode] = useState<Mode>("published");
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState<DraftSlot | null>(null);
  const [busy, setBusy] = useState<null | "publish" | "discard" | "move" | "blank">(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Manual timetabling: the section's assignments feed the add-subject picker,
  // and `addingAt` holds the empty cell the HOD clicked.
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [addingAt, setAddingAt] = useState<{ day: DayOfWeek; period: number } | null>(null);

  const days: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const loadAll = useCallback(async () => {
    try {
      const [coursesData, sectionsData, timingsData, slotsData, draftData, assignData] = await Promise.all([
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
      ]);

      setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
      setSection((sectionsData.sections ?? []).find((s) => s.id === sectionId) ?? null);
      setTiming((timingsData.timings ?? []).find((t) => t.year === Number(year)) ?? null);
      setSlots(slotsData.slots ?? []);
      setDraft(draftData.draft ?? null);
      setAssignments((assignData.assignments ?? []).filter((a) => !a.isPast));
      // An unpublished draft is what the HOD most likely came here to act on.
      if (draftData.draft && draftData.draft.status === "DRAFT") setMode("draft");
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
  const draftHasSlots = Boolean(draft?.slots?.length);
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
      setMode("draft");
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

  async function handlePublish() {
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
      setMode("published");
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
      setMode("published");
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
        title={course && section ? `${course.name} · ${ordinalYear(Number(year))} · Section ${section.name}` : "Timetable"}
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
            <Button size="sm" variant={mode === "published" ? "default" : "outline"} onClick={() => { setMode("published"); setIsEditing(false); setSelected(null); }}>
              Published
            </Button>
            <Button size="sm" variant={mode === "draft" ? "default" : "outline"} onClick={() => setMode("draft")}>
              Draft {draftIsUnpublished && <Badge variant="secondary" className="ml-1.5">unpublished</Badge>}
            </Button>
          </div>
          {mode === "draft" && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant={isEditing ? "default" : "outline"} onClick={() => { setIsEditing((v) => !v); setSelected(null); }}>
                {isEditing ? <><X className="h-4 w-4 mr-1.5" />Done editing</> : "Edit"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(true)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-1.5" />Discard
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmPublish(true)}
                loading={busy === "publish"}
                disabled={busy !== null || !draftHasSlots}
                title={draftHasSlots ? undefined : "Add at least one subject before publishing"}
              >
                <Upload className="h-4 w-4 mr-1.5" />Publish
              </Button>
            </div>
          )}
        </div>
      )}

      {mode === "draft" && isEditing && (
        <p className="text-sm text-muted-foreground">
          {selected
            ? `Moving ${selected.subjectName} - click an empty period to place it, or click it again to cancel.`
            : "Click an empty period to add a subject, or a placed subject to move or remove it. Pinned slots cannot be changed here."}
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
                      const isPinnedCell = Boolean(pinned) || (mode === "published" && pSlot?.source !== "GENERATED" && pSlot !== undefined);
                      const isSelected =
                        selected && dSlot &&
                        selected.assignmentId === dSlot.assignmentId &&
                        selected.day === dSlot.day &&
                        selected.periodNumber === dSlot.periodNumber;

                      const clickable = mode === "draft" && isEditing && !pinned;

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

          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects are assigned to this section yet. Add them under Teaching Assignments first.
            </p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {assignments.map((a) => (
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
        title="Publish this timetable?"
        description="It becomes visible to the Principal, Vice Principal, every faculty member teaching this section, and the Class Leader. Any previously generated slots for this section are replaced; pinned slots are kept."
        confirmLabel="Publish"
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
