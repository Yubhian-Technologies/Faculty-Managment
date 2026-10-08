"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { StudentDayTimetable } from "@/components/timetable/StudentDayTimetable";
import { ALL_DAYS, ordinalYear } from "@/lib/timetable/gridModel";
import { toRoman, formatAcademicShortNotation } from "@/lib/academic/format";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, SubjectType, Subject, TeachingAssignment, DayOfWeek } from "@/types";
import { yearSemesterLabelIn, semesterInYearLabel } from "@/lib/academic/format";

type TimetableSlotRow = TimetableSlot & { id: string; subjectType?: SubjectType };

interface ApiResponse {
  course?: Course | null;
  section?: Section | null;
  timing?: CourseYearTiming | null;
  slots?: TimetableSlotRow[];
  assignments?: (TeachingAssignment & { id: string })[];
  subjects?: Subject[];
  resolvedSemester?: number | null;
  availableSemesters?: { semester: number; label?: string }[];
  workingDays?: DayOfWeek[];
  departments?: Department[];
  myLabBatch?: string;
  error?: string;
}

function todayDay(): DayOfWeek {
  const idx = new Date().getDay(); // 0 = Sunday
  return idx === 0 ? "MON" : ALL_DAYS[idx - 1];
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Own-section weekly timetable for a STUDENT login. On a phone it opens on one
// day at a time (day buttons + that day's periods); "Week" and wide screens
// show the whole grid, which also carries the PDF / Excel / print downloads.
export default function StudentTimetablePage() {
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [assignments, setAssignments] = useState<(TeachingAssignment & { id: string })[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableSemesters, setAvailableSemesters] = useState<{ semester: number; label?: string }[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [myLabBatch, setMyLabBatch] = useState("");
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [batchValue, setBatchValue] = useState("");
  const [view, setView] = useState<"day" | "week">("day");
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(todayDay);
  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);

  function changeWeek(d: Date) {
    setIsLoading(true);
    setWeekStart(d);
  }

  function changeSemester(s: number | null) {
    setIsLoading(true);
    setSelectedSemester(s);
  }

  useEffect(() => {
    const params = new URLSearchParams({ week: isoDateKey(weekStart) });
    if (selectedSemester != null) params.set("semester", String(selectedSemester));

    fetch(`/api/college/student/me/timetable?${params.toString()}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => {
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
        setTiming(d.timing ?? null);
        setSlots(d.slots ?? []);
        setAssignments(d.assignments ?? []);
        setSubjects(d.subjects ?? []);
        setDepartments(d.departments ?? []);
        setAvailableSemesters(d.availableSemesters ?? []);
        setWorkingDays(d.workingDays ?? []);
        setMyLabBatch(d.myLabBatch ?? "");
        if (selectedSemester == null && d.resolvedSemester != null) setSelectedSemester(d.resolvedSemester);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => setIsLoading(false));
  }, [weekStart, selectedSemester]);

  function isTheorySlot(s: TimetableSlotRow): boolean {
    if (s.subjectType === "THEORY") return true;
    if (s.subjectType === "PRACTICAL" || s.labBatch) return false;
    const name = (s.subjectName || "").toLowerCase();
    return !name.includes("lab") && !name.includes("practical");
  }

  function isPracticalSlot(s: TimetableSlotRow): boolean {
    if (s.subjectType === "PRACTICAL" || s.labBatch) return true;
    if (s.subjectType === "THEORY") return false;
    const name = (s.subjectName || "").toLowerCase();
    return name.includes("lab") || name.includes("practical");
  }

  // When the server already narrowed lab periods to this student's own batch
  // there is nothing to pick; the batch filter only appears for a student with
  // no batch assigned yet.
  const batchOptions = useMemo(
    () => (myLabBatch ? [] : Array.from(new Set(slots.map((s) => s.labBatch).filter((b): b is string => !!b)))),
    [slots, myLabBatch]
  );

  const filteredSlots = useMemo(
    () =>
      slots.filter((s) => {
        if (typeFilter === "THEORY" && !isTheorySlot(s)) return false;
        if (typeFilter === "PRACTICAL" && !isPracticalSlot(s)) return false;
        if (batchValue && s.labBatch !== batchValue) return false;
        return true;
      }),
    [slots, typeFilter, batchValue]
  );

  const departmentName = useMemo(() => {
    if (!section) return "";
    return departments.find((d) => d.id === section.department || d.name === section.department)?.name || section.department;
  }, [departments, section]);

  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 5);
  const isThisWeek = isoDateKey(weekStart) === isoDateKey(currentWeekDates()[0]);
  const shiftWeek = (days: number) =>
    changeWeek(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + days));

  const showSemesterPicker = availableSemesters.length > 1;
  const showBatchPicker = batchOptions.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          section
            ? `${formatAcademicShortNotation({
                year: section.year,
                courseName: course?.name,
                courseCode: course?.code,
                semester: selectedSemester,
                sectionName: section.name,
              })}`
            : "My Timetable"
        }
        description={section && course ? `${departmentName} · Timetable` : "Your weekly class schedule"}
      />

      {isLoading && !timing ? (
        <div className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-xs">
          <TableSkeleton rows={6} cols={4} />
        </div>
      ) : !section ? (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">No class linked</p>
          <p className="mt-1 text-xs">No class or section is linked to your login yet. Please contact your College Office.</p>
        </div>
      ) : !timing ? (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">Timings not set up</p>
          <p className="mt-1 text-xs">Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(section.year)} yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 rounded-2xl border border-border/60 bg-card/90 p-3 shadow-xs sm:p-4">
            {/* Week: prev / label / next, and a way back to this week */}
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftWeek(-7)} aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 text-center">
                <p className="text-sm font-medium">{shortDate(weekStart)} – {shortDate(weekEnd)}</p>
                {!isThisWeek && (
                  <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => changeWeek(currentWeekDates()[0])}>
                    Back to this week
                  </button>
                )}
              </div>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftWeek(7)} aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {showSemesterPicker && (
                <div className="space-y-1">
                  <Label className="text-xs">Semester</Label>
                  <Select value={selectedSemester != null ? String(selectedSemester) : ""} onValueChange={(v) => changeSemester(Number(v))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Semester" /></SelectTrigger>
                    <SelectContent>
                      {availableSemesters.map((s) => (
                        <SelectItem key={s.semester} value={String(s.semester)}>
                          {semesterInYearLabel(availableSemesters.map((x) => x.semester), s.semester, { format: "short" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Show</Label>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="THEORY">Theory</SelectItem>
                    <SelectItem value="PRACTICAL">Practical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {showBatchPicker && (
                <div className="space-y-1">
                  <Label className="text-xs">Lab batch</Label>
                  <Select value={batchValue || "__all__"} onValueChange={(v) => setBatchValue(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All batches</SelectItem>
                      {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="lg:hidden">
              <SegmentedTabs
                className="w-full [&>button]:flex-1"
                options={[{ key: "day", label: "Day" }, { key: "week", label: "Week" }]}
                value={view}
                onChange={(k) => setView(k as "day" | "week")}
              />
            </div>
          </div>

          {isLoading && (
            <p className="text-center text-xs text-muted-foreground" role="status">Loading…</p>
          )}

          {/* Phone: one day at a time */}
          <div className={view === "day" ? "lg:hidden" : "hidden"}>
            <StudentDayTimetable
              weekStart={weekStart}
              timing={timing}
              slots={filteredSlots}
              subjects={subjects}
              workingDays={workingDays}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </div>

          {/* Whole week: always on wide screens, on request on phones */}
          <div className={`min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card/90 p-2 shadow-xs sm:p-4 ${view === "day" ? "hidden lg:block" : ""}`}>
            <InstitutionalTimetableTable
              section={section}
              timing={timing}
              slots={filteredSlots}
              courseName={course?.name}
              departmentName={departmentName}
              academicYear={slots[0]?.academicYear}
              semesterLabel={selectedSemester ? `${toRoman(selectedSemester)} Sem Time Table` : undefined}
              workingDays={workingDays}
              weekStart={weekStart}
              onWeekChange={changeWeek}
              showWeekNav={false}
              assignments={assignments}
              subjects={subjects}
            />
          </div>
        </>
      )}
    </div>
  );
}
