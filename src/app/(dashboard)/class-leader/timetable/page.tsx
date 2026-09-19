"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, Utensils } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDMY, currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { buildRows } from "@/lib/timetable/buildGrid";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { computeSemesterOptions, resolveYearsForSemesterChoice, type SemesterChoice } from "@/lib/college/semester";
import { WeekNavigator } from "@/components/timetable/WeekNavigator";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, DayOfWeek, SubjectType } from "@/types";
import { DAY_LABELS } from "@/types";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

type TimetableSlotRow = TimetableSlot & { id: string; subjectType?: SubjectType };

// Encoded as one string for the <Select>: "sem:<n>" or "full:<year>" - see
// lib/college/semester.ts's SemesterChoice for what each means.
function encodeSemesterChoice(c: SemesterChoice): string {
  return c.kind === "semester" ? `sem:${c.value}` : `full:${c.year}`;
}
function decodeSemesterChoice(s: string): SemesterChoice | null {
  const [kind, raw] = s.split(":");
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return kind === "sem" ? { kind: "semester", value: n } : kind === "full" ? { kind: "fullYear", year: n } : null;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** "09:00" -> "9:00 AM" - display only. */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

interface ApiResponse {
  course?: Course | null;
  section?: Section | null;
  timing?: CourseYearTiming | null;
  slots?: TimetableSlotRow[];
  resolvedSemester?: number | null;
  ownSectionId?: string | null;
  courses?: Course[];
  departments?: Department[];
  sections?: Section[];
  courseYearTimings?: CourseYearTiming[];
  error?: string;
}

export default function ClassLeaderTimetablePage() {
  // Browse lists - fetched once, independent of which section is on screen.
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allSections, setAllSections] = useState<Section[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Picker selections - Course -> Department -> Semester -> Section.
  const [courseGroupKey, setCourseGroupKey] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [semesterChoiceStr, setSemesterChoiceStr] = useState("");
  const [sectionId, setSectionId] = useState("");

  // The resolved section's own timetable data.
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Optional filters, derived from the loaded section's own slots.
  const [theorySubjectId, setTheorySubjectId] = useState("");
  const [labSubjectId, setLabSubjectId] = useState("");
  const [batchValue, setBatchValue] = useState("");

  // Monday of the week currently on screen - navigable via WeekNavigator,
  // defaulting to this calendar week. weekDates pairs positionally with
  // DAYS above, labelling each column with its actual date.
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);
  const weekDates = useMemo(() => currentWeekDates(weekStart), [weekStart]);

  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);

  // Initial load - resolves the caller's own bound section AND the browse
  // lists in one call, then seeds the picker to match it (still fully
  // changeable afterwards).
  useEffect(() => {
    fetch("/api/college/class-leader/timetable")
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => {
        setCourses(d.courses ?? []);
        setDepartments(d.departments ?? []);
        setAllSections(d.sections ?? []);
        setTimings(d.courseYearTimings ?? []);
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
        setTiming(d.timing ?? null);
        setSlots(d.slots ?? []);

        if (d.section) {
          const group = buildCourseGroups(d.courses ?? []).find((g) => g.courseIds.includes(d.section!.courseId));
          if (group) setCourseGroupKey(group.key);
          setDepartmentId(d.section.department);
          setSemesterChoiceStr(
            encodeSemesterChoice(
              d.resolvedSemester != null
                ? { kind: "semester", value: d.resolvedSemester }
                : { kind: "fullYear", year: d.section.year }
            )
          );
          setSectionId(d.section.id);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => {
        setIsLoading(false);
        setInitialized(true);
      });
    // Only on mount - subsequent section/semester changes are loaded by the
    // effect below instead.
  }, []);

  // Re-fetch this one section's timetable whenever the resolved section,
  // selected semester, or displayed week changes (not on the very first
  // render - that's covered by the initial-load effect above).
  useEffect(() => {
    if (!initialized || !sectionId) return;
    const choice = decodeSemesterChoice(semesterChoiceStr);
    setIsLoading(true);
    const params = new URLSearchParams({ week: isoDateKey(weekStart), sectionId });
    if (choice?.kind === "semester") params.set("semester", String(choice.value));
    fetch(`/api/college/class-leader/timetable?${params.toString()}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => {
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
        setTiming(d.timing ?? null);
        setSlots(d.slots ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => setIsLoading(false));
  }, [sectionId, semesterChoiceStr, weekStart, initialized]);

  // Clear the optional filters whenever the underlying section/semester
  // changes - a Batch/Lab/Theory value from a previous section rarely
  // applies to the next one.
  useEffect(() => {
    setTheorySubjectId(""); setLabSubjectId(""); setBatchValue("");
  }, [sectionId, semesterChoiceStr]);

  // ─── Cascade option lists, computed from the browse data + current picks ──

  const departmentOptions = useMemo(() => {
    const group = courseGroups.find((g) => g.key === courseGroupKey);
    if (!group) return [];
    const deptIds = new Set(courses.filter((c) => group.courseIds.includes(c.id)).map((c) => c.departmentId));
    return departments.filter((d) => deptIds.has(d.id));
  }, [courseGroups, courseGroupKey, courses, departments]);

  // This Course+Department's own matching Course doc id(s) - usually one,
  // but a duplicate legacy doc for the same department is unioned rather
  // than picked arbitrarily.
  const matchingCourseIds = useMemo(() => {
    const group = courseGroups.find((g) => g.key === courseGroupKey);
    if (!group || !departmentId) return [];
    return courses.filter((c) => group.courseIds.includes(c.id) && c.departmentId === departmentId).map((c) => c.id);
  }, [courseGroups, courseGroupKey, departmentId, courses]);

  const matchingSections = useMemo(
    () => allSections.filter((s) => matchingCourseIds.includes(s.courseId) && s.department === departmentId),
    [allSections, matchingCourseIds, departmentId]
  );

  // Every Year this Course+Department actually has a section for - the
  // universe of years the Semester step below has to cover, so a Year with
  // no semesters configured is never silently unreachable.
  const candidateYears = useMemo(
    () => Array.from(new Set(matchingSections.map((s) => s.year))).sort((a, b) => a - b),
    [matchingSections]
  );

  // This Course+Department's own CourseYearTiming, keyed by year - the shared
  // input both lib/college/semester.ts helpers below resolve against.
  const timingByYear = useMemo(() => {
    const map = new Map<number, CourseYearTiming | undefined>();
    for (const year of candidateYears) {
      map.set(year, timings.find((x) => matchingCourseIds.includes(x.courseId) && x.year === year));
    }
    return map;
  }, [candidateYears, timings, matchingCourseIds]);

  const semesterOptions = useMemo(() => {
    return computeSemesterOptions(candidateYears, timingByYear).map((choice) => ({
      choice,
      label: choice.kind === "semester" ? `Semester ${choice.value}` : `${ordinalYear(choice.year)} - Full Year`,
    }));
  }, [candidateYears, timingByYear]);

  // Which Year(s) the chosen semester option resolves to - a semester shared
  // by more than one Year (rare, but not disallowed - see
  // resolveYearsForSemesterChoice's own doc-comment) unions their sections
  // rather than picking one arbitrarily.
  const resolvedYears = useMemo(() => {
    const choice = decodeSemesterChoice(semesterChoiceStr);
    return choice ? resolveYearsForSemesterChoice(candidateYears, timingByYear, choice) : [];
  }, [semesterChoiceStr, candidateYears, timingByYear]);

  const sectionOptions = useMemo(
    () => matchingSections.filter((s) => resolvedYears.includes(s.year)),
    [matchingSections, resolvedYears]
  );

  function handleCourseChange(key: string) {
    setCourseGroupKey(key); setDepartmentId(""); setSemesterChoiceStr(""); setSectionId("");
  }
  function handleDepartmentChange(id: string) {
    setDepartmentId(id); setSemesterChoiceStr(""); setSectionId("");
  }
  function handleSemesterChange(v: string) {
    setSemesterChoiceStr(v); setSectionId("");
  }

  // ─── Optional filters, derived from the loaded section's own slots ───────

  const theoryOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of slots) if (s.subjectType === "THEORY" && s.subjectId) byId.set(s.subjectId, s.subjectName);
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [slots]);
  const labOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of slots) if (s.subjectType === "PRACTICAL" && s.subjectId) byId.set(s.subjectId, s.subjectName);
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [slots]);
  const batchOptions = useMemo(
    () => Array.from(new Set(slots.map((s) => s.labBatch).filter((b): b is string => !!b))),
    [slots]
  );
  const hasActiveFilters = !!(theorySubjectId || labSubjectId || batchValue);
  const filteredSlots = useMemo(
    () => slots.filter((s) =>
      (!theorySubjectId || s.subjectId === theorySubjectId) &&
      (!labSubjectId || s.subjectId === labSubjectId) &&
      (!batchValue || s.labBatch === batchValue)
    ),
    [slots, theorySubjectId, labSubjectId, batchValue]
  );

  const rows = timing ? buildRows(timing) : [];

  // Plural - a split period (two+ subjects/faculty sharing one section+day+
  // period) means a cell can hold more than one.
  function slotsFor(day: DayOfWeek, period: number) {
    return filteredSlots.filter((s) => s.day === day && s.periodNumber === period);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={course && section ? `${course.name} · ${ordinalYear(section.year)} · Section ${section.name}` : "Timetable"}
        description="Browse a section's weekly timetable - updates automatically when faculty assignments change"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label className="text-xs">Course</Label>
          <Select value={courseGroupKey} onValueChange={handleCourseChange}>
            <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
            <SelectContent>
              {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Department</Label>
          <Select value={departmentId} onValueChange={handleDepartmentChange} disabled={!courseGroupKey}>
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              {departmentOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Semester</Label>
          <Select value={semesterChoiceStr} onValueChange={handleSemesterChange} disabled={!departmentId}>
            <SelectTrigger><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>
              {semesterOptions.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No years found</div>}
              {semesterOptions.map((o) => (
                <SelectItem key={encodeSemesterChoice(o.choice)} value={encodeSemesterChoice(o.choice)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Section</Label>
          <Select value={sectionId} onValueChange={setSectionId} disabled={!semesterChoiceStr}>
            <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              {sectionOptions.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No sections found</div>}
              {sectionOptions.map((s) => <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !section ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No section is linked to your login yet - pick a Course, Department, Semester and Section above to view its timetable.
        </div>
      ) : !timing ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(section.year)} yet.
        </div>
      ) : (
        <>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
          <div className="flex items-end gap-2 flex-wrap">
            {theoryOptions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Theory</Label>
                <Select value={theorySubjectId || "__all__"} onValueChange={(v) => setTheorySubjectId(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {theoryOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {labOptions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Lab</Label>
                <Select value={labSubjectId || "__all__"} onValueChange={(v) => setLabSubjectId(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {labOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {batchOptions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Batch</Label>
                <Select value={batchValue || "__all__"} onValueChange={(v) => setBatchValue(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setTheorySubjectId(""); setLabSubjectId(""); setBatchValue(""); }}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="p-2.5 text-left font-medium text-muted-foreground border-b w-24">Period</th>
                {DAYS.map((d, i) => (
                  <th key={d} className="p-2.5 text-left font-medium text-muted-foreground border-b min-w-[140px]">
                    <p className="text-[10px] font-normal whitespace-nowrap">{formatDMY(weekDates[i])}</p>
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
                      <td colSpan={DAYS.length + 1} className="p-2 text-center text-xs font-medium text-amber-700">
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
                    <td className="p-2.5 font-medium text-muted-foreground">
                      {row.period}
                      {row.startTime && row.endTime && (
                        <p className="text-[10px] font-normal whitespace-nowrap">
                          {formatTime12h(row.startTime)}&ndash;{formatTime12h(row.endTime)}
                        </p>
                      )}
                    </td>
                    {DAYS.map((d) => {
                      const cellSlots = slotsFor(d, row.period);
                      return (
                        <td key={d} className="p-2 align-top">
                          {cellSlots.length > 0 ? (
                            <div className="space-y-1">
                              {cellSlots.map((slot) => (
                                <div key={slot.assignmentId || slot.id} className={`rounded-md border p-2 ${slot.substituteFacultyName ? "bg-amber-50 border-amber-200" : "bg-primary/5 border-primary/20"}`}>
                                  <p className="text-xs font-semibold leading-tight">
                                    {slot.subjectName}
                                    {slot.labBatch ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">({slot.labBatch})</span> : null}
                                  </p>
                                  {slot.substituteFacultyName ? (
                                    <>
                                      <p className="text-[11px] font-medium text-amber-700 mt-0.5">{slot.substituteFacultyName}</p>
                                      <p className="text-[10px] text-muted-foreground">
                                        Substituting for {slot.substituteForName}{slot.substituteDate ? ` (${formatDMY(slot.substituteDate)})` : ""}
                                      </p>
                                    </>
                                  ) : (
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{slot.facultyName}</p>
                                  )}
                                  {slot.classroom && <p className="text-[11px] text-muted-foreground">{slot.classroom}</p>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">-</div>
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
        </>
      )}
    </div>
  );
}
