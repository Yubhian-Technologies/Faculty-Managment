"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Calendar,
  CalendarDays,
  Clock,
  ExternalLink,
  GraduationCap,
  Layers,
  MapPin,
  User,
  UserCheck,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { toast } from "@/hooks/useToast";
import type { Course, CourseYearTiming, Department, Section, TimetableSlot, TeachingAssignment, SubjectType } from "@/types";
import { DAY_LABELS, type DayOfWeek } from "@/types";

type TimetableSlotRow = TimetableSlot & {
  id: string;
  subjectType?: SubjectType;
  subjectCode?: string;
  shortCode?: string;
};
type AssignmentRow = TeachingAssignment & { id: string };

const DAYS_ORDER: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

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

/** Format "09:00" -> "9:00 AM" */
function formatTime12h(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
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

  // Filter slots for the selected day and sort by period number
  const daySlots = useMemo(() => {
    return slots
      .filter((s) => s.day === selectedDay)
      .sort((a, b) => a.periodNumber - b.periodNumber);
  }, [slots, selectedDay]);

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

  const isCurrentDayToday = new Date().getDay() !== 0 && selectedDay === todayDay;

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-primary border-primary/30 font-semibold px-2.5 py-0.5 text-xs">
              Class Representative Portal
            </Badge>
            {resolvedSemester && (
              <Badge variant="secondary" className="text-xs">
                Semester {resolvedSemester}
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {section ? `Section ${section.name} Dashboard` : "Class Leader Dashboard"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {section && course
              ? `${course.name} · ${departmentName} · ${ordinalYear(section.year)}`
              : "Your section's schedule and subject assignments"}
          </p>
        </div>

        {section && !isHidden("/class-leader/timetable") && (
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild className="gap-2 shadow-xs">
              <Link href="/class-leader/timetable">
                <CalendarDays className="h-4 w-4" />
                <span>Full Timetable Grid</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
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
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <Layers className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-base">No Section Linked</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your login is not currently bound to an academic section. Please ask your College Office or Department HOD to link your class section.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ── Key Section Metrics Grid (Balanced 4 cards, zero overflow) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="shadow-2xs border-border/80">
              <CardContent className="p-3.5 sm:p-4 flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Class &amp; Section</p>
                  <p className="font-bold text-sm sm:text-base text-foreground truncate">
                    Sec {section.name} {section.batch ? `· ${section.batch}` : ""}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-2xs border-border/80">
              <CardContent className="p-3.5 sm:p-4 flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Department</p>
                  <p className="font-bold text-sm sm:text-base text-foreground truncate" title={departmentName}>
                    {departmentName}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-2xs border-border/80">
              <CardContent className="p-3.5 sm:p-4 flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Academic Year</p>
                  <p className="font-bold text-sm sm:text-base text-foreground truncate">
                    {ordinalYear(section.year)} {resolvedSemester ? `(Sem ${resolvedSemester})` : ""}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-2xs border-border/80">
              <CardContent className="p-3.5 sm:p-4 flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <UserCog className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Faculty In-Charge</p>
                  <p className="font-bold text-sm sm:text-base text-foreground truncate" title={section.facultyInchargeName || "Not assigned"}>
                    {section.facultyInchargeName || "Not assigned"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Daily Schedule (Direct Timetable on Dashboard) ── */}
          <Card className="shadow-xs border-border/80 overflow-hidden">
            <CardHeader className="p-4 sm:p-5 border-b bg-card/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>Class Schedule</span>
                  {isCurrentDayToday && (
                    <Badge variant="default" className="text-[10px] uppercase font-bold tracking-wider py-0 px-1.5 h-5 bg-primary">
                      Today
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Direct period schedule for {DAY_LABELS[selectedDay]}
                </p>
              </div>

              {/* Day Selection Tabs (Zero horizontal overflow) */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 max-w-full no-scrollbar">
                {DAYS_ORDER.map((d) => {
                  const isSelected = selectedDay === d;
                  const isToday = todayDay === d;
                  return (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() => setSelectedDay(d)}
                      className={`h-7 px-2.5 text-xs font-medium shrink-0 transition-all ${
                        isSelected ? "shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d}
                      {isToday && (
                        <span className={`ml-1 h-1.5 w-1.5 rounded-full ${isSelected ? "bg-white" : "bg-primary"}`} />
                      )}
                    </Button>
                  );
                })}
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5">
              {daySlots.length === 0 ? (
                <div className="py-10 text-center space-y-2 rounded-lg border border-dashed bg-muted/10">
                  <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">No classes scheduled for {DAY_LABELS[selectedDay]}</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Enjoy your day off or review earlier course material!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {daySlots.map((slot) => {
                    const periodTime = periodTimingsMap.get(slot.periodNumber);
                    const timeLabel = periodTime
                      ? `${formatTime12h(periodTime.startTime)} – ${formatTime12h(periodTime.endTime)}`
                      : `Period ${slot.periodNumber}`;
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
                        {/* Period & Time header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center justify-center h-5 px-1.5 rounded text-[11px] font-bold bg-muted text-foreground">
                              P{slot.periodNumber}
                            </span>
                            <span className="text-xs font-semibold text-muted-foreground">
                              {timeLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {slot.subjectType && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-4 uppercase font-semibold ${
                                  isLab
                                    ? "text-emerald-700 dark:text-emerald-300 border-emerald-300"
                                    : "text-blue-700 dark:text-blue-300 border-blue-300"
                                }`}
                              >
                                {isLab ? "Lab" : "Theory"}
                              </Badge>
                            )}
                            {slot.labBatch && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {slot.labBatch}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Subject Details */}
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-foreground leading-snug line-clamp-2" title={slot.subjectName}>
                            {slot.subjectName}
                          </p>
                          {(slot.subjectCode || slot.shortCode) && (
                            <p className="text-xs font-mono text-muted-foreground mt-0.5">
                              {slot.subjectCode || slot.shortCode}
                            </p>
                          )}
                        </div>

                        {/* Faculty & Room Footer */}
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

          {/* ── Subjects & Faculty Section (Clean, strictly current-semester) ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">
                  Current Semester Subjects
                </h2>
                <Badge variant="secondary" className="text-xs px-2 py-0">
                  {groupedSubjects.length} {groupedSubjects.length === 1 ? "Subject" : "Subjects"}
                </Badge>
              </div>
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
                  const isLab = sub.subjectType === "PRACTICAL";
                  return (
                    <Card key={sub.subjectId || sub.subjectCode} className="shadow-2xs border-border/80 flex flex-col justify-between">
                      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                              {sub.shortCode || sub.subjectCode || "SUB"}
                            </span>
                            {sub.subjectType && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold ${
                                  isLab
                                    ? "text-emerald-700 dark:text-emerald-300 border-emerald-300"
                                    : "text-blue-700 dark:text-blue-300 border-blue-300"
                                }`}
                              >
                                {isLab ? "Practical" : "Theory"}
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-sm text-foreground line-clamp-2" title={sub.subjectName}>
                            {sub.subjectName}
                          </p>
                          {sub.subjectCode && (
                            <p className="text-xs text-muted-foreground font-mono">
                              {sub.subjectCode}
                            </p>
                          )}
                        </div>

                        {/* Faculty list */}
                        <div className="pt-2.5 border-t border-border/60 space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            Faculty In-Charge
                          </p>
                          {sub.facultyList.map((f, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                              <div className="flex items-center gap-1.5 truncate">
                                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] shrink-0 font-bold">
                                  {f.name.charAt(0)}
                                </div>
                                <span className="truncate">{f.name}</span>
                              </div>
                              {f.batch && (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                                  {f.batch}
                                </Badge>
                              )}
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
