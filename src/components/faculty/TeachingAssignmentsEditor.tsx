"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Course, Section, Subject, CourseYearTiming, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

export interface StagedSlot {
  localId: string;
  id?: string;
  day: DayOfWeek;
  periodNumber: number;
}

export interface StagedTeachingRow {
  localId: string;
  id?: string;
  courseId: string;
  courseName: string;
  year: number;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  hoursPerWeek: number;
  slots: StagedSlot[];
}

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
const NO_SUBJECT = "__none__"; // sentinel: Radix Select items can't use an empty string value

function newLocalId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `local_${Date.now()}_${Math.random()}`;
}

function emptyRow(): StagedTeachingRow {
  return {
    localId: newLocalId(),
    courseId: "", courseName: "", year: 0,
    sectionId: "", sectionName: "",
    subjectId: "", subjectName: "", subjectCode: "",
    hoursPerWeek: 0,
    slots: [],
  };
}

interface Props {
  value: StagedTeachingRow[];
  onChange: (rows: StagedTeachingRow[]) => void;
}

export function TeachingAssignmentsEditor({ value, onChange }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [sectionsCache, setSectionsCache] = useState<Record<string, Section[]>>({});
  const [subjectsCache, setSubjectsCache] = useState<Record<string, Subject[]>>({});
  const [timingCache, setTimingCache] = useState<Record<string, CourseYearTiming | null>>({});
  const [occupiedCache, setOccupiedCache] = useState<Record<string, { assignmentId: string; day: string; periodNumber: number }[]>>({});

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => { /* non-critical */ });
  }, []);

  async function ensureCourseYearData(courseId: string, year: number) {
    const key = `${courseId}_${year}`;
    if (!(key in sectionsCache)) {
      const res = await fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${year}`);
      const d = await res.json() as { sections: Section[] };
      setSectionsCache((c) => ({ ...c, [key]: d.sections ?? [] }));
    }
    if (!(key in subjectsCache)) {
      const res = await fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}&year=${year}`);
      const d = await res.json() as { subjects: Subject[] };
      setSubjectsCache((c) => ({ ...c, [key]: d.subjects ?? [] }));
    }
    if (!(key in timingCache)) {
      const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`);
      const d = await res.json() as { timings: CourseYearTiming[] };
      const timing = (d.timings ?? []).find((t) => t.year === year) ?? null;
      setTimingCache((c) => ({ ...c, [key]: timing }));
    }
  }

  async function ensureOccupied(sectionId: string) {
    if (sectionId in occupiedCache) return;
    const res = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`);
    const d = await res.json() as { slots: { assignmentId: string; day: string; periodNumber: number }[] };
    setOccupiedCache((c) => ({ ...c, [sectionId]: d.slots ?? [] }));
  }

  // Hydrate caches for rows that arrive pre-populated (e.g. loaded from the server when
  // editing an existing faculty member), not just ones the user just selected interactively.
  useEffect(() => {
    for (const row of value) {
      if (row.courseId && row.year) void ensureCourseYearData(row.courseId, row.year);
      if (row.sectionId) void ensureOccupied(row.sectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function updateRow(localId: string, patch: Partial<StagedTeachingRow>) {
    onChange(value.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    onChange([...value, emptyRow()]);
  }

  function removeRow(localId: string) {
    onChange(value.filter((r) => r.localId !== localId));
  }

  async function handleCourseChange(row: StagedTeachingRow, courseId: string) {
    const course = courses.find((c) => c.id === courseId);
    updateRow(row.localId, {
      courseId, courseName: course?.name ?? "",
      year: 0, sectionId: "", sectionName: "", subjectId: "", subjectName: "", subjectCode: "", hoursPerWeek: 0, slots: [],
    });
  }

  async function handleYearChange(row: StagedTeachingRow, year: number) {
    updateRow(row.localId, { year, sectionId: "", sectionName: "", subjectId: "", subjectName: "", subjectCode: "", hoursPerWeek: 0, slots: [] });
    await ensureCourseYearData(row.courseId, year);
  }

  async function handleSectionChange(row: StagedTeachingRow, sectionId: string) {
    const key = `${row.courseId}_${row.year}`;
    const section = (sectionsCache[key] ?? []).find((s) => s.id === sectionId);
    updateRow(row.localId, { sectionId, sectionName: section?.name ?? "", slots: [] });
    await ensureOccupied(sectionId);
  }

  function handleSubjectChange(row: StagedTeachingRow, subjectId: string) {
    if (subjectId === NO_SUBJECT) {
      // HOD is clearing the subject to leave this course/section row's periods empty for now,
      // without deleting the whole row.
      updateRow(row.localId, {
        subjectId: "", subjectName: "", subjectCode: "", hoursPerWeek: 0, slots: [],
      });
      return;
    }
    const key = `${row.courseId}_${row.year}`;
    const subject = (subjectsCache[key] ?? []).find((s) => s.id === subjectId);
    updateRow(row.localId, {
      subjectId,
      subjectName: subject?.name ?? "",
      subjectCode: subject?.code ?? "",
      hoursPerWeek: subject?.hoursPerWeek ?? 0,
    });
  }

  function toggleSlot(row: StagedTeachingRow, day: DayOfWeek, periodNumber: number) {
    const exists = row.slots.find((s) => s.day === day && s.periodNumber === periodNumber);
    if (!exists && row.slots.length >= row.hoursPerWeek) return; // cap reached — hours/week defines the slot count
    const slots = exists
      ? row.slots.filter((s) => !(s.day === day && s.periodNumber === periodNumber))
      : [...row.slots, { localId: newLocalId(), day, periodNumber }];
    updateRow(row.localId, { slots });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Teaching Assignments</p>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add Course
        </Button>
      </div>

      {value.length === 0 && <p className="text-xs text-muted-foreground">No teaching assignments added yet.</p>}

      {value.map((row) => {
        const course = courses.find((c) => c.id === row.courseId) ?? null;
        const yearOptions = course ? Array.from({ length: course.durationYears }, (_, i) => i + 1) : [];
        const key = `${row.courseId}_${row.year}`;
        const sections = sectionsCache[key] ?? [];
        const subjects = subjectsCache[key] ?? [];
        const timing = timingCache[key];
        const occupied = occupiedCache[row.sectionId] ?? [];
        const periodNumbers = timing ? Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1) : [];
        // Periods this same faculty member is already teaching in any other row (any other
        // section/year/course, including ones staged but not yet saved) — a teacher can't be
        // in two classes at once, so these must block regardless of which section they're in.
        const facultyBusyElsewhere = new Set(
          value
            .filter((r) => r.localId !== row.localId)
            .flatMap((r) => r.slots.map((s) => `${s.day}_${s.periodNumber}`))
        );
        // Subjects this faculty is already assigned to in another row shouldn't be offered
        // again — picking the same subject twice would just duplicate the assignment.
        const subjectsUsedElsewhere = new Set(
          value.filter((r) => r.localId !== row.localId).map((r) => r.subjectId).filter(Boolean)
        );
        const availableSubjects = subjects.filter((s) => s.id === row.subjectId || !subjectsUsedElsewhere.has(s.id));

        return (
          <div key={row.localId} className="space-y-3 rounded-md bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Course</Label>
                  <Select value={row.courseId} onValueChange={(v) => void handleCourseChange(row, v)}>
                    <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
                    <SelectContent>
                      {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Year</Label>
                  <Select value={row.year ? String(row.year) : ""} onValueChange={(v) => void handleYearChange(row, Number(v))} disabled={!course}>
                    <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Year {y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Section</Label>
                  <Select value={row.sectionId} onValueChange={(v) => void handleSectionChange(row, v)} disabled={!row.year}>
                    <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
                    <SelectContent>
                      {sections.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No sections for this year</div>}
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Select value={row.subjectId} onValueChange={(v) => handleSubjectChange(row, v)} disabled={!row.year}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SUBJECT}>None — leave periods empty</SelectItem>
                      {subjects.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects for this year</div>}
                      {subjects.length > 0 && availableSubjects.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All subjects for this year are already assigned</div>
                      )}
                      {availableSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={() => removeRow(row.localId)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {row.subjectId && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Hours to Allot / Week</Label>
                  <p className="text-sm font-medium">{row.hoursPerWeek}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Set on the subject — edit it from Subjects if this needs to change.
                  </p>
                </div>
              </div>
            )}

            {row.sectionId && row.subjectId && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <Label className="text-xs">
                    Weekly Schedule — pick day &amp; period for this subject/section
                    {" "}({row.slots.length}/{row.hoursPerWeek} periods selected)
                  </Label>
                </div>
                {!timing ? (
                  <p className="text-xs text-amber-600">
                    Timings not configured for {row.courseName} Year {row.year} yet — ask the Principal to set them up before scheduling periods.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="p-1.5 text-left text-muted-foreground font-normal">Period</th>
                          {DAYS.map((d) => (
                            <th key={d} className="p-1.5 text-muted-foreground font-normal">{DAY_LABELS[d].slice(0, 3)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {periodNumbers.map((p) => (
                          <tr key={p}>
                            <td className="p-1.5 font-medium">{p}</td>
                            {DAYS.map((d) => {
                              const selected = row.slots.some((s) => s.day === d && s.periodNumber === p);
                              // Slots already belonging to this same assignment (loaded from the server)
                              // are this row's own — deselecting one must free it, not lock it as "taken".
                              const sectionConflict = occupied.some(
                                (s) => s.day === d && s.periodNumber === p && s.assignmentId !== row.id
                              );
                              const selfConflict = !selected && facultyBusyElsewhere.has(`${d}_${p}`);
                              const takenByOther = sectionConflict || selfConflict;
                              const capReached = !selected && row.slots.length >= row.hoursPerWeek;
                              const disabled = takenByOther || capReached;
                              return (
                                <td key={d} className="p-1">
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggleSlot(row, d, p)}
                                    className={`h-6 w-10 rounded border text-[10px] transition-colors ${
                                      selected
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : disabled
                                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                                          : "bg-background hover:bg-muted border-border"
                                    }`}
                                    title={
                                      sectionConflict
                                        ? "Already occupied for this section"
                                        : selfConflict
                                          ? "This faculty already teaches another class at this time (different section/year)"
                                          : capReached
                                            ? "Hours/week limit reached — increase hours/week to select more periods"
                                            : undefined
                                    }
                                  >
                                    {selected ? "✓" : takenByOther ? "✕" : ""}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
