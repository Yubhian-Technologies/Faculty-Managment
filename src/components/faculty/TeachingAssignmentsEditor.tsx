"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, BookOpen, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Course, Department, Section, Subject, CourseYearTiming, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import { buildCourseGroups } from "@/lib/departments/hodScope";

export interface StagedSlot {
  localId: string;
  id?: string;
  day: DayOfWeek;
  periodNumber: number;
  // Set when this slot was deliberately placed onto a cell another subject
  // already occupies (a split period) - see toggleSlot below and
  // syncTeachingAssignments.ts, which forwards it to the create-slot APIs.
  allowSplit?: boolean;
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
  // Which academic year/semester this assignment belongs to - captured for every
  // row, current or past. Past rows use the same course/year/section/subject
  // picker but have no weekly schedule (historical, nothing left to book) and
  // additionally carry the students' pass %.
  assignmentAcademicYear?: string;
  assignmentSemester?: string;
  isPast?: boolean;
  passPercentage?: number;
  studentFeedback?: number;
}

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
const NO_SUBJECT = "__none__"; // sentinel: Radix Select items can't use an empty string value

function newLocalId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `local_${Date.now()}_${Math.random()}`;
}

function emptyRow(isPast = false): StagedTeachingRow {
  return {
    localId: newLocalId(),
    courseId: "", courseName: "", year: 0,
    sectionId: "", sectionName: "",
    subjectId: "", subjectName: "", subjectCode: "",
    hoursPerWeek: 0,
    slots: [],
    assignmentAcademicYear: "",
    assignmentSemester: "",
    ...(isPast ? { isPast: true, passPercentage: undefined, studentFeedback: undefined } : {}),
  };
}

interface Props {
  value: StagedTeachingRow[];
  onChange: (rows: StagedTeachingRow[]) => void;
  // The faculty member's own department (e.g. "INFORMATION TECHNOLOGY") -
  // Year options are scoped to ONLY this department's own Course Year
  // Timings (Department.courseScopes), never unioned with a sibling
  // department's own years just because both happen to share the same
  // catalog programme (see courseGroups below). Basic Science's own Year 1
  // and Information Technology's own Years 2-4 are two different
  // departments' own faculty pools, even though they show up under one
  // merged "Bachelor of Technology" pick in the Course dropdown.
  department?: string;
}

export function TeachingAssignmentsEditor({ value, onChange, department }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const ownDepartment = useMemo(
    () => (department ? departments.find((d) => d.name === department) : undefined),
    [departments, department]
  );
  const [sectionsCache, setSectionsCache] = useState<Record<string, Section[]>>({});
  const [subjectsCache, setSubjectsCache] = useState<Record<string, Subject[]>>({});
  const [timingCache, setTimingCache] = useState<Record<string, CourseYearTiming[]>>({});
  const [occupiedCache, setOccupiedCache] = useState<Record<string, { assignmentId: string; day: string; periodNumber: number }[]>>({});
  // Every department's own "Bachelor of Technology" Course doc collapsed into
  // one pick per catalog programme - a scope spanning several departments
  // otherwise shows the same course name once per department (see
  // buildCourseGroups's own doc-comment; same fix already used by the
  // Sections page and hod/teaching-assignments).
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => { /* non-critical */ });
    // Needed to disambiguate same-named sections in the Section picker below -
    // e.g. two "Section A"s both owned by Basic Science but cross-listed to
    // different branches (CSE vs ECE), or one owned by a parent department and
    // another by its sub-department - see sectionDisplayLabel.
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => { /* non-critical */ });
  }, []);

  // Queried once per course-doc id in the group and merged - the sections/
  // subjects/timings APIs take a single courseId, and one merged catalog
  // programme (courseGroups) can span several of them, one per department.
  async function ensureCourseYearData(courseIds: string[], year: number) {
    if (courseIds.length === 0) return;
    const key = `${courseIds.join("|")}_${year}`;
    try {
      if (!(key in sectionsCache)) {
        const lists = await Promise.all(
          courseIds.map((cId) =>
            fetch(`/api/college/sections?courseId=${encodeURIComponent(cId)}&year=${year}`)
              .then((r) => r.json() as Promise<{ sections: Section[] }>)
              .then((d) => d.sections ?? [])
          )
        );
        const byId = new Map(lists.flat().map((s) => [s.id, s]));
        setSectionsCache((c) => ({ ...c, [key]: Array.from(byId.values()) }));
      }
      if (!(key in subjectsCache)) {
        const lists = await Promise.all(
          courseIds.map((cId) =>
            fetch(`/api/college/subjects?courseId=${encodeURIComponent(cId)}&year=${year}`)
              .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
              .then((d) => d.subjects ?? [])
          )
        );
        const byId = new Map(lists.flat().map((s) => [s.id, s]));
        setSubjectsCache((c) => ({ ...c, [key]: Array.from(byId.values()) }));
      }
      if (!(key in timingCache)) {
        const lists = await Promise.all(
          courseIds.map((cId) =>
            fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(cId)}`)
              .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
              .then((d) => (d.timings ?? []).filter((t) => t.year === year))
          )
        );
        setTimingCache((c) => ({ ...c, [key]: lists.flat() }));
      }
    } catch {
      // Non-critical - transient network hiccup (e.g. a dev-server reload mid-request).
      // The relevant dropdown just stays empty/disabled; picking the course/year again retries.
    }
  }

  async function ensureOccupied(sectionId: string) {
    if (sectionId in occupiedCache) return;
    try {
      const res = await fetch(`/api/college/timetable-slots?sectionId=${encodeURIComponent(sectionId)}`);
      const d = await res.json() as { slots: { assignmentId: string; day: string; periodNumber: number }[] };
      setOccupiedCache((c) => ({ ...c, [sectionId]: d.slots ?? [] }));
    } catch {
      // Non-critical - see ensureCourseYearData.
    }
  }

  // Hydrate caches for rows that arrive pre-populated (e.g. loaded from the server when
  // editing an existing faculty member), not just ones the user just selected interactively.
  useEffect(() => {
    for (const row of value) {
      if (row.courseId && row.year) {
        const group = courseGroups.find((g) => g.courseIds.includes(row.courseId));
        void ensureCourseYearData(group ? group.courseIds : [row.courseId], row.year);
      }
      if (row.sectionId && !row.isPast) void ensureOccupied(row.sectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, courseGroups]);

  function updateRow(localId: string, patch: Partial<StagedTeachingRow>) {
    onChange(value.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }

  function addRow(isPast = false) {
    onChange([...value, emptyRow(isPast)]);
  }

  function removeRow(localId: string) {
    onChange(value.filter((r) => r.localId !== localId));
  }

  async function handleCourseChange(row: StagedTeachingRow, groupKey: string) {
    const group = courseGroups.find((g) => g.key === groupKey);
    updateRow(row.localId, {
      // Just a representative member of the group for now - resolved to the
      // section's own real courseId once one is picked below, since a merged
      // programme's docs each belong to a different department.
      courseId: group?.courseIds[0] ?? "", courseName: group?.name ?? "",
      year: 0, sectionId: "", sectionName: "", subjectId: "", subjectName: "", subjectCode: "", hoursPerWeek: 0, slots: [],
    });
  }

  async function handleYearChange(row: StagedTeachingRow, year: number) {
    updateRow(row.localId, { year, sectionId: "", sectionName: "", subjectId: "", subjectName: "", subjectCode: "", hoursPerWeek: 0, slots: [] });
    const group = courseGroups.find((g) => g.courseIds.includes(row.courseId));
    await ensureCourseYearData(group ? group.courseIds : [row.courseId], year);
  }

  async function handleSectionChange(row: StagedTeachingRow, sectionId: string) {
    const group = courseGroups.find((g) => g.courseIds.includes(row.courseId));
    const key = `${(group ? group.courseIds : [row.courseId]).join("|")}_${row.year}`;
    const section = (sectionsCache[key] ?? []).find((s) => s.id === sectionId);
    updateRow(row.localId, {
      sectionId, sectionName: section?.name ?? "",
      // The section's OWN real courseId, not the merged group's
      // representative pick - it may belong to a sibling department's own
      // Course doc within a shared programme (buildCourseGroups), and the
      // saved assignment must point at the doc that actually owns it.
      ...(section?.courseId ? { courseId: section.courseId } : {}),
      slots: [],
    });
    if (!row.isPast) await ensureOccupied(sectionId);
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
    const group = courseGroups.find((g) => g.courseIds.includes(row.courseId));
    const key = `${(group ? group.courseIds : [row.courseId]).join("|")}_${row.year}`;
    const subject = (subjectsCache[key] ?? []).find((s) => s.id === subjectId);
    updateRow(row.localId, {
      subjectId,
      subjectName: subject?.name ?? "",
      subjectCode: subject?.code ?? "",
      hoursPerWeek: subject?.hoursPerWeek ?? 0,
    });
  }

  function toggleSlot(row: StagedTeachingRow, day: DayOfWeek, periodNumber: number, allowSplit = false) {
    const exists = row.slots.find((s) => s.day === day && s.periodNumber === periodNumber);
    if (!exists && row.slots.length >= row.hoursPerWeek) return; // cap reached - hours/week defines the slot count
    const slots = exists
      ? row.slots.filter((s) => !(s.day === day && s.periodNumber === periodNumber))
      : [...row.slots, { localId: newLocalId(), day, periodNumber, ...(allowSplit ? { allowSplit: true } : {}) }];
    updateRow(row.localId, { slots });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teaching Assignments</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => addRow(false)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Course
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addRow(true)}>
            <History className="h-3.5 w-3.5 mr-1" />Add Previous Teaching Assignment
          </Button>
        </div>
      </div>

      {value.length === 0 && <p className="text-xs text-muted-foreground">No teaching assignments added yet.</p>}

      {value.filter((r) => !r.isPast).length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Current</p>
          {value.filter((r) => !r.isPast).map(renderRow)}
        </div>
      )}
      {value.filter((r) => r.isPast).length > 0 && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Previous</p>
          {value.filter((r) => r.isPast).map(renderRow)}
        </div>
      )}
    </div>
  );

  function renderRow(row: StagedTeachingRow) {
        // One pick per catalog programme, not per department's own Course doc
        // (see courseGroups above) - resolved back from row.courseId, which
        // (once a section is chosen) is that section's own real courseId.
        const group = courseGroups.find((g) => g.courseIds.includes(row.courseId)) ?? null;
        // Scoped to THIS faculty member's own department's Years Taught
        // (Department.courseScopes, via resolveDepartmentCourseScope) - never
        // unioned with a sibling department sharing the same merged group
        // (courseGroups above collapses the Course dropdown across
        // departments, but a Basic Science faculty member has no business
        // being offered Information Technology's own Years 2-4 just because
        // both share one "Bachelor of Technology" pick, and vice versa for
        // Basic Science's own Year 1).
        const yearOptions = (() => {
          if (!group) return [];
          const courseYears = Array.from({ length: group.durationYears }, (_, i) => i + 1);
          if (!ownDepartment) return courseYears; // no department context supplied - can't scope, show everything
          const assigned = resolveDepartmentCourseScope(ownDepartment, group.catalogId).assignedYears;
          return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
        })();
        const activeCourseIds = group ? group.courseIds : (row.courseId ? [row.courseId] : []);
        const key = `${activeCourseIds.join("|")}_${row.year}`;
        const sections = sectionsCache[key] ?? [];
        const subjects = subjectsCache[key] ?? [];
        // This row's own courseId's timing specifically, once a section has
        // resolved it to one concrete department - falling back to whichever
        // member's timing loaded first before that (they're expected to
        // agree; see the "Timings not configured" message below for when
        // none has one at all).
        const timingsForKey = timingCache[key] ?? [];
        const timing = timingsForKey.find((t) => t.courseId === row.courseId) ?? timingsForKey[0] ?? null;
        const occupied = occupiedCache[row.sectionId] ?? [];
        const periodNumbers = timing ? Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1) : [];
        // Periods this same faculty member is already teaching in any other row (any other
        // section/year/course, including ones staged but not yet saved) - a teacher can't be
        // in two classes at once, so these must block regardless of which section they're in.
        const facultyBusyElsewhere = new Set(
          value
            .filter((r) => r.localId !== row.localId)
            .flatMap((r) => r.slots.map((s) => `${s.day}_${s.periodNumber}`))
        );
        // Subjects this faculty is already CURRENTLY assigned to in another row shouldn't be
        // offered again - picking the same subject twice would just duplicate the live
        // assignment. Past rows are exempt on both sides: a subject taught in a prior year
        // legitimately may be taught again now, and past rows themselves don't conflict.
        const subjectsUsedElsewhere = new Set(
          value.filter((r) => r.localId !== row.localId && !r.isPast).map((r) => r.subjectId).filter(Boolean)
        );
        // Narrow to the picked section's own curriculum regulation, if it has
        // one set - a section otherwise shows every regulation's subjects for
        // the year mixed together, which invites assigning the wrong batch's
        // curriculum. Lenient both ways (matches api/college/subjects GET's
        // own regulation filter): a subject with no regulation of its own
        // still shows, and an unset section regulation shows everything.
        const selectedSection = sections.find((s) => s.id === row.sectionId);
        const regulationFiltered = subjects.filter(
          (s) => !selectedSection?.regulation || !s.regulation || s.regulation === selectedSection.regulation
        );
        const availableSubjects = row.isPast
          ? regulationFiltered
          : regulationFiltered.filter((s) => s.id === row.subjectId || !subjectsUsedElsewhere.has(s.id));

        return (
          <div key={row.localId} className="space-y-3 rounded-md bg-muted/30 p-3">
            {row.isPast && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                <History className="h-3 w-3" />Previous Teaching Assignment
              </span>
            )}
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Course</Label>
                  <Select value={group?.key ?? ""} onValueChange={(v) => void handleCourseChange(row, v)}>
                    <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
                    <SelectContent>
                      {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Year</Label>
                  <Select value={row.year ? String(row.year) : ""} onValueChange={(v) => void handleYearChange(row, Number(v))} disabled={!group}>
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
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Select value={row.subjectId} onValueChange={(v) => handleSubjectChange(row, v)} disabled={!row.year}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SUBJECT}>None - leave periods empty</SelectItem>
                      {subjects.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects for this year</div>}
                      {subjects.length > 0 && availableSubjects.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All subjects for this year are already assigned</div>
                      )}
                      {availableSubjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.code}{s.regulation ? ` · ${s.regulation}` : ""})</SelectItem>
                      ))}
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
                    Set on the subject - edit it from Subjects if this needs to change.
                  </p>
                </div>
              </div>
            )}

            {row.subjectId && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Academic Year</Label>
                  <Input
                    value={row.assignmentAcademicYear ?? ""}
                    onChange={(e) => updateRow(row.localId, { assignmentAcademicYear: e.target.value })}
                    placeholder="e.g. 2025-2026"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Semester</Label>
                  <Input
                    value={row.assignmentSemester ?? ""}
                    onChange={(e) => updateRow(row.localId, { assignmentSemester: e.target.value })}
                    placeholder="e.g. I Semester"
                  />
                </div>
                {row.isPast && (
                  <div className="space-y-1">
                    <Label className="text-xs">Student Pass %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={row.passPercentage ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updateRow(row.localId, { passPercentage: raw === "" ? undefined : Math.min(100, Math.max(0, Number(raw))) });
                      }}
                      placeholder="0-100"
                    />
                  </div>
                )}
                {row.isPast && (
                  <div className="space-y-1">
                    <Label className="text-xs">Student Feedback %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={row.studentFeedback ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updateRow(row.localId, { studentFeedback: raw === "" ? undefined : Math.min(100, Math.max(0, Number(raw))) });
                      }}
                      placeholder="0-100"
                    />
                  </div>
                )}
              </div>
            )}

            {!row.isPast && row.sectionId && row.subjectId && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <Label className="text-xs">
                    Weekly Schedule (optional) - pin a day &amp; period for this subject/section
                    {" "}({row.slots.length}/{row.hoursPerWeek} periods selected)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground -mt-1">
                  Optional. Anything pinned here shows as locked when building the rest of the
                  timetable manually from <span className="font-medium">Timetable</span>.
                </p>
                {!timing ? (
                  <p className="text-xs text-amber-600">
                    Timings not configured for {row.courseName} Year {row.year} yet - ask the Principal to set them up before scheduling periods.
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
                              // are this row's own - deselecting one must free it, not lock it as "taken".
                              const sectionConflict = occupied.some(
                                (s) => s.day === d && s.periodNumber === p && s.assignmentId !== row.id
                              );
                              // A section conflict is still selectable - it's a split period (two+
                              // subjects/faculty sharing this cell), a deliberate choice, not an
                              // error - only a genuine faculty double-booking hard-blocks below.
                              const selfConflict = !selected && facultyBusyElsewhere.has(`${d}_${p}`);
                              const capReached = !selected && row.slots.length >= row.hoursPerWeek;
                              const disabled = selfConflict || capReached;
                              return (
                                <td key={d} className="p-1">
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggleSlot(row, d, p, sectionConflict)}
                                    className={`h-6 w-10 rounded border text-[10px] transition-colors ${
                                      selected
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : disabled
                                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                                          : sectionConflict
                                            ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                                            : "bg-background hover:bg-muted border-border"
                                    }`}
                                    title={
                                      sectionConflict
                                        ? "Another subject already occupies this period - selecting it creates a split period"
                                        : selfConflict
                                          ? "This faculty already teaches another class at this time (different section/year)"
                                          : capReached
                                            ? "Hours/week limit reached - increase hours/week to select more periods"
                                            : undefined
                                    }
                                  >
                                    {selected ? "✓" : selfConflict ? "✕" : sectionConflict ? "⚡" : ""}
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
  }
}
