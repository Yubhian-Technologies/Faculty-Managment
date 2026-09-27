"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, CalendarDays, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { currentWeekDates } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { InstitutionalTimetableTable } from "@/components/timetable/InstitutionalTimetableTable";
import type { Course, Department, Section, CourseYearTiming, TimetableSlot, SubjectType, TeachingAssignment } from "@/types";

type TimetableSlotRow = TimetableSlot & { id: string; subjectType?: SubjectType };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

interface ApiResponse {
  course?: Course | null;
  section?: Section | null;
  timing?: CourseYearTiming | null;
  slots?: TimetableSlotRow[];
  assignments?: (TeachingAssignment & { id: string })[];
  resolvedSemester?: number | null;
  availableSemesters?: { semester: number; label?: string }[];
  departments?: Department[];
  error?: string;
}

export default function ClassLeaderTimetablePage() {
  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [assignments, setAssignments] = useState<(TeachingAssignment & { id: string })[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableSemesters, setAvailableSemesters] = useState<{ semester: number; label?: string }[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Optional filters
  const [theorySubjectId, setTheorySubjectId] = useState("");
  const [labSubjectId, setLabSubjectId] = useState("");
  const [batchValue, setBatchValue] = useState("");

  const [weekStart, setWeekStart] = useState<Date>(() => currentWeekDates()[0]);

  // Load timetable data for own section
  useEffect(() => {
    setIsLoading(true);
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
        setDepartments(d.departments ?? []);
        setAvailableSemesters(d.availableSemesters ?? []);
        if (selectedSemester == null && d.resolvedSemester != null) {
          setSelectedSemester(d.resolvedSemester);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load timetable" }))
      .finally(() => setIsLoading(false));
  }, [weekStart, selectedSemester]);

  // Filters derived from slots
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

  const hasActiveFilters = Boolean(theorySubjectId || labSubjectId || batchValue);

  const filteredSlots = useMemo(
    () =>
      slots.filter(
        (s) =>
          (!theorySubjectId || s.subjectId === theorySubjectId) &&
          (!labSubjectId || s.subjectId === labSubjectId) &&
          (!batchValue || s.labBatch === batchValue)
      ),
    [slots, theorySubjectId, labSubjectId, batchValue]
  );

  const departmentName = useMemo(() => {
    if (!section) return "";
    return departments.find((d) => d.id === section.department || d.name === section.department)?.name || section.department;
  }, [departments, section]);

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title={
            section
              ? `Section ${section.name} · Timetable`
              : "Class Timetable"
          }
          description={
            section && course
              ? `${course.name} · ${departmentName} · ${ordinalYear(section.year)}`
              : "Your class weekly schedule"
          }
        />
        <div className="flex items-center gap-2">
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
                      onClick={() => setSelectedSemester(sem.semester)}
                    >
                      Semester {sem.semester}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {theoryOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={theorySubjectId || "__all__"}
                    onValueChange={(v) => setTheorySubjectId(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 text-xs w-36">
                      <SelectValue placeholder="Theory: All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Theory</SelectItem>
                      {theoryOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {labOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={labSubjectId || "__all__"}
                    onValueChange={(v) => setLabSubjectId(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 text-xs w-32">
                      <SelectValue placeholder="Lab: All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Labs</SelectItem>
                      {labOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                    setTheorySubjectId("");
                    setLabSubjectId("");
                    setBatchValue("");
                  }}
                  className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {/* Timetable Table with full PDF/XLS export */}
          <div className="w-full max-w-full overflow-x-auto">
            <InstitutionalTimetableTable
              section={section}
              timing={timing}
              slots={filteredSlots}
              courseName={course?.name}
              departmentName={departmentName}
              academicYear={slots[0]?.academicYear}
              semesterLabel={selectedSemester ? `Semester ${selectedSemester}` : undefined}
              weekStart={weekStart}
              onWeekChange={setWeekStart}
              showWeekNav={true}
              assignments={assignments}
            />
          </div>
        </div>
      )}
    </div>
  );
}
