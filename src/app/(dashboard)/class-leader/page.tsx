"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Calendar,
  CalendarDays,
  Clock,
  MapPin,
  User,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { toast } from "@/hooks/useToast";
import { ordinalYear, resolveTimetableDays } from "@/lib/timetable/gridModel";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import { toRoman, formatAcademicShortNotation } from "@/lib/academic/format";
import { WeeklyTimetableMatrix } from "@/components/timetable/WeeklyTimetableMatrix";
import type { Course, CourseYearTiming, Department, Section, TimetableSlot, TeachingAssignment, SubjectType, DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

type TimetableSlotRow = TimetableSlot & {
  id: string;
  subjectType?: SubjectType;
  subjectCode?: string;
  shortCode?: string;
};
type AssignmentRow = TeachingAssignment & { id: string };

function getTodayDayOfWeek(): DayOfWeek {
  const dayIndex = new Date().getDay(); // 0 is Sunday, 1 is Monday...
  const map: Record<number, DayOfWeek> = {
    1: "MON",
    2: "TUE",
    3: "WED",
    4: "THU",
    5: "FRI",
    6: "SAT",
  };
  return map[dayIndex] ?? "MON";
}

export default function ClassLeaderDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);

  const [course, setCourse] = useState<Course | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [resolvedSemester, setResolvedSemester] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Day selector for schedule timeline
  const todayDay = useMemo(() => getTodayDayOfWeek(), []);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(todayDay);
  useEffect(() => {
    fetch("/api/college/class-leader/timetable")
      .then(
        (r) =>
          r.json() as Promise<{
            course?: Course;
            section?: Section;
            timing?: CourseYearTiming;
            slots?: TimetableSlotRow[];
            assignments?: AssignmentRow[];
            departments?: Department[];
            resolvedSemester?: number;
            error?: string;
          }>
      )
      .then((d) => {
        setCourse(d.course ?? null);
        setSection(d.section ?? null);
        setTiming(d.timing ?? null);
        setSlots(d.slots ?? []);
        setAssignments(d.assignments ?? []);
        setDepartments(d.departments ?? []);
        setResolvedSemester(d.resolvedSemester ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section data" }))
      .finally(() => setIsLoading(false));
  }, []);

  const departmentName = useMemo(() => {
    if (!section) return "-";
    return departments.find((d) => d.id === section.department || d.name === section.department)?.name || section.department;
  }, [departments, section]);

  // Group teaching assignments cleanly by subject to prevent duplicate messy rows
  const groupedSubjects = useMemo(() => {
    const map = new Map<
      string,
      {
        subjectId: string;
        subjectName: string;
        subjectCode: string;
        shortCode?: string;
        subjectType?: SubjectType;
        hoursPerWeek: number;
        facultyList: { name: string; batch?: string }[];
      }
    >();

    for (const a of assignments) {
      const key = a.subjectId || a.subjectCode || a.subjectName;
      const existing = map.get(key);
      const facultyEntry = {
        name: a.facultyName || "Not assigned",
        batch: a.section ? a.section : undefined,
      };

      if (!existing) {
        map.set(key, {
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          subjectCode: a.subjectCode,
          shortCode: a.shortCode,
          subjectType: a.subjectType,
          hoursPerWeek: a.hoursPerWeek || 0,
          facultyList: [facultyEntry],
        });
      } else {
        if (!existing.facultyList.some((f) => f.name === facultyEntry.name)) {
          existing.facultyList.push(facultyEntry);
        }
      }
    }

    return Array.from(map.values());
  }, [assignments]);

  // Only the days this college actually teaches (the API resolves them from
  // the college's TimetableRules.workingDays, unioned with any day a slot
  // actually occupies) - never a hardcoded Mon-Sat, and never a day the
  // timetable has nothing for, so the tab strip only offers real choices.
  const daysWithClasses = useMemo(() => {
    const byDay = new Set(slots.map((s) => s.day));
    const resolved = resolveTimetableDays(null, byDay);
    return resolved.filter((d) => byDay.has(d));
  }, [slots]);

  // `selectedDay` can name a day the tab strip no longer offers (today on a
  // Sunday, or a day whose classes were all filtered away) - fall back rather
  // than render an empty panel the user has no control to escape.
  const activeDay = daysWithClasses.includes(selectedDay)
    ? selectedDay
    : daysWithClasses[0] ?? resolveTimetableDays()[0];

  // Filter slots for the selected day and sort by period number
  const daySlots = useMemo(() => {
    return slots
      .filter((s) => s.day === activeDay)
      .sort((a, b) => a.periodNumber - b.periodNumber);
  }, [slots, activeDay]);

  // Lookup timing details for each period using `period: number` from PeriodTiming
  const periodTimingsMap = useMemo(() => {
    const map = new Map<number, { startTime: string; endTime: string }>();
    if (timing?.periods) {
      for (const p of timing.periods) {
        map.set(p.period, { startTime: p.startTime, endTime: p.endTime });
      }
    }
    return map;
  }, [timing]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground break-words">
            {section
              ? `${formatAcademicShortNotation({
                  year: section.year,
                  courseName: course?.name,
                  courseCode: course?.code,
                  semester: resolvedSemester,
                  sectionName: section.name,
                })} Dashboard`
              : "Class Leader Dashboard"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 break-words">
            {section && course
              ? [
                  departmentName,
                  section.batch,
                  section.facultyInchargeName ? `In-charge: ${section.facultyInchargeName}` : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Your section's schedule and subject assignments"}
          </p>
        </div>

        {section && !isHidden("/class-leader/timetable") && (
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild variant="outline" className="gap-2 w-full sm:w-auto">
              <Link href="/class-leader/timetable">
                <CalendarDays className="h-4 w-4 shrink-0" />
                <span className="truncate">Full Timetable</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="h-28 rounded-xl border bg-muted/30 animate-pulse" />
          <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
        </div>
      ) : !section ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <h3 className="font-semibold text-base">No Section Linked</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your login is not currently bound to an academic section. Please ask your College Office or Department HOD to link your class section.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">

          {/* ── Daily Schedule ── */}
          <Card className="shadow-xs border-border/80 overflow-hidden">
            <CardHeader className="p-4 sm:p-5 border-b bg-card/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary shrink-0" />
                  <span>Class Schedule</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {DAY_LABELS[activeDay]}&rsquo;s periods
                </p>
              </div>

              {/* Day selector - only the days this timetable actually has
                  classes on. */}
              {daysWithClasses.length > 1 && (
                <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 py-0.5 no-scrollbar" role="tablist" aria-label="Day">
                  {daysWithClasses.map((d) => {
                    const isSelected = activeDay === d;
                    return (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        role="tab"
                        aria-selected={isSelected}
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => setSelectedDay(d)}
                        className={`h-8 px-2.5 text-xs font-medium shrink-0 transition-all ${
                          isSelected ? "shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="sm:hidden">{DAY_LABELS[d]?.slice(0, 3)}</span>
                        <span className="hidden sm:inline">{DAY_LABELS[d]}</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardHeader>

            <CardContent className="p-4 sm:p-5">
              {daySlots.length === 0 ? (
                <div className="py-10 text-center space-y-2 rounded-lg border border-dashed bg-muted/10">
                  <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">No classes scheduled for {DAY_LABELS[activeDay]}</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Enjoy your day off or review earlier course material!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {daySlots.map((slot) => {
                    const periodTime = periodTimingsMap.get(slot.periodNumber);
                    const isSub = Boolean(slot.substituteFacultyName);
                    const isLab = slot.subjectType === "PRACTICAL";

                    return (
                      <div
                        key={slot.id}
                        className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between gap-3 ${
                          isSub
                            ? "bg-amber-500/5 border-amber-500/30 dark:bg-amber-950/20"
                            : isLab
                            ? "bg-emerald-500/5 border-emerald-500/20 dark:bg-emerald-950/20"
                            : "bg-card hover:bg-muted/15 border-border"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold text-muted-foreground">
                            Period {slot.periodNumber}
                            {periodTime && ` · ${formatTime12h(periodTime.startTime)} – ${formatTime12h(periodTime.endTime)}`}
                          </p>
                          {isLab && (
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
                              Lab
                            </p>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-foreground leading-snug line-clamp-2" title={slot.subjectName}>
                            {slot.subjectName}
                            {slot.labBatch && <span className="font-normal text-muted-foreground"> · {slot.labBatch}</span>}
                          </p>
                          {(slot.subjectCode || slot.shortCode) && (
                            <p className="text-xs font-mono text-muted-foreground mt-0.5">
                              {slot.subjectCode || slot.shortCode}
                            </p>
                          )}
                        </div>

                        <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0 text-muted-foreground">
                            {isSub ? (
                              <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium truncate">
                                <UserCheck className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">Sub: {slot.substituteFacultyName}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 truncate">
                                <User className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{slot.facultyName || "Not assigned"}</span>
                              </div>
                            )}
                          </div>

                          {slot.classroom && (
                            <div className="flex items-center gap-1 text-muted-foreground shrink-0 font-medium text-[11px]">
                              <MapPin className="h-3 w-3 text-muted-foreground/70" />
                              <span>{slot.classroom}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Subjects & Faculty ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                {resolvedSemester ? `${toRoman(resolvedSemester)} Sem Subjects` : "Current Semester Subjects"}
              </h2>
            </div>

            {groupedSubjects.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  No subjects or faculty are assigned for this semester yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {groupedSubjects.map((sub) => {
                  return (
                    <Card key={sub.subjectId || sub.subjectCode} className="shadow-2xs border-border/80 flex flex-col justify-between">
                      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                        <div className="space-y-1.5 min-w-0">
                          <p className="text-xs font-mono font-bold text-primary">
                            {sub.shortCode || sub.subjectCode || "SUB"}
                            {sub.subjectType === "PRACTICAL" && (
                              <span className="font-sans font-medium text-muted-foreground"> · Lab</span>
                            )}
                          </p>
                          <p className="font-semibold text-sm text-foreground line-clamp-2" title={sub.subjectName}>
                            {sub.subjectName}
                          </p>
                          {sub.subjectCode && (
                            <p className="text-xs text-muted-foreground font-mono">
                              {sub.subjectCode}
                            </p>
                          )}
                        </div>

                        <div className="pt-2.5 border-t border-border/60 space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Faculty
                          </p>
                          {sub.facultyList.map((f, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] shrink-0 font-bold">
                                {f.name.charAt(0)}
                              </div>
                              <span className="truncate">
                                {f.name}
                                {f.batch && <span className="font-normal text-muted-foreground"> · {f.batch}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
