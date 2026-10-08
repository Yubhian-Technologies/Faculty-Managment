"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import { ordinalYear } from "@/lib/timetable/gridModel";
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
  error?: string;
}

export default function ClassLeaderTimetablePage() {
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [assignments, setAssignments] = useState<(TeachingAssignment & { id: string })[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableSemesters, setAvailableSemesters] = useState<{ semester: number; label?: string }[]>([]);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filters: All / Theory / Practical + Optional Batch
  const [typeFilter, setTypeFilter] = useState<"ALL" | "THEORY" | "PRACTICAL">("ALL");
  const [batchValue, setBatchValue] = useState("");

  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);

  // Loading state is set alongside the state change that triggers a reload
  // (week/semester switch), never synchronously inside the fetch effect below.
  function changeWeek(d: Date) {
    setIsLoading(true);
    setWeekStart(d);
  }

  function changeSemester(s: number | null) {
    setIsLoading(true);
    setSelectedSemester(s);
  }

  // Load timetable data for own section
  useEffect(() => {
    const params = new URLSearchParams({ week: isoDateKey(weekStart) });
    if (selectedSemester != null) {
      params.set("semester", String(selectedSemester));
    }

    fetch(`/api/college/class-leader/timetable?${params.toString()}`)
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
        if (selectedSemester == null && d.resolvedSemester != null) {
          setSelectedSemester(d.resolvedSemester);
        }
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

  const batchOptions = useMemo(
    () => Array.from(new Set(slots.map((s) => s.labBatch).filter((b): b is string => !!b))),
    [slots]
  );

  const hasActiveFilters = typeFilter !== "ALL" || Boolean(batchValue);

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (typeFilter === "THEORY" && !isTheorySlot(s)) return false;
      if (typeFilter === "PRACTICAL" && !isPracticalSlot(s)) return false;
      if (batchValue && s.labBatch !== batchValue) return false;
      return true;
    });
  }, [slots, typeFilter, batchValue]);

  const departmentName = useMemo(() => {
    if (!section) return "";
    return departments.find((d) => d.id === section.department || d.name === section.department)?.name || section.department;
  }, [departments, section]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title={
            section
              ? `${formatAcademicShortNotation({
                  year: section.year,
                  courseName: course?.name,
                  courseCode: course?.code,
                  semester: selectedSemester,
                  sectionName: section.name,
                })} · Timetable`
              : "Class Timetable"
          }
          description={
            section && course
              ? `${departmentName} · Weekly Schedule`
              : "Your class weekly schedule"
          }
        />
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <Link href="/class-leader">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-96 rounded-xl border bg-muted/30 animate-pulse flex items-center justify-center text-sm text-muted-foreground">
          Loading timetable...
        </div>
      ) : !section ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
          <p className="font-semibold text-foreground text-base">No Section Linked</p>
          <p className="mt-1 text-xs">No class/section is linked to your login yet. Please contact your College Office or HOD to bind your section.</p>
        </div>
      ) : !timing ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
          <p className="font-semibold text-foreground text-base">Timings Not Configured</p>
          <p className="mt-1 text-xs">Timings haven&rsquo;t been configured for {course?.name} - {ordinalYear(section.year)} yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Controls Bar: Semester toggle + Subject filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-card/60 shadow-xs">
            {/* Semester Switcher if available */}
            {availableSemesters.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Semester:</span>
                <div className="inline-flex rounded-lg border p-0.5 bg-muted/30">
                  {availableSemesters.map((sem) => (
                    <Button
                      key={sem.semester}
                      type="button"
                      size="sm"
                      variant={selectedSemester === sem.semester ? "default" : "ghost"}
                      className="h-7 text-xs px-3"
                      onClick={() => changeSemester(sem.semester)}
                    >
                      {semesterInYearLabel(availableSemesters.map((x) => x.semester), sem.semester, { format: "short" })}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Filters: Type (All / Theory / Practical) + Batch */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border p-0.5 bg-muted/30">
                {(["ALL", "THEORY", "PRACTICAL"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={typeFilter === t ? "default" : "ghost"}
                    className="h-7 text-xs px-3 font-medium transition-all"
                    onClick={() => setTypeFilter(t)}
                  >
                    {t === "ALL" ? "All" : t === "THEORY" ? "Theory" : "Practical"}
                  </Button>
                ))}
              </div>

              {batchOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={batchValue || "__all__"}
                    onValueChange={(v) => setBatchValue(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 text-xs w-28">
                      <SelectValue placeholder="Batch: All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Batches</SelectItem>
                      {batchOptions.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTypeFilter("ALL");
                    setBatchValue("");
                  }}
                  className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {/* Timetable Table with full PDF/Excel export */}
          <div className="w-full min-w-0">
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
              showWeekNav={true}
              assignments={assignments}
              subjects={subjects}
            />
          </div>
        </div>
      )}
    </div>
  );
}
