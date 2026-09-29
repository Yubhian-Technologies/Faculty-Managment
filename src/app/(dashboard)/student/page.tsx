"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  Clock,
  FileText,
  MapPin,
  TrendingDown,
  TrendingUp,
  User,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { resolveTimetableDays } from "@/lib/timetable/gridModel";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import { formatAcademicShortNotation } from "@/lib/academic/format";
import { DEFAULT_SHORTAGE_THRESHOLD, isShortageByPercent } from "@/lib/studentAttendance/shortage";
import { formatPercent } from "@/lib/studentAttendance/percentage";
import type { StudentAttendanceHistory } from "@/lib/studentAttendance/history";
import type { Course, CourseYearTiming, Section, StudentRecord, TimetableSlot, SubjectType, DayOfWeek } from "@/types";

type TimetableSlotRow = TimetableSlot & { id: string; subjectType?: SubjectType; subjectCode?: string; shortCode?: string };

interface MeResponse {
  student: (StudentRecord & { id: string }) | null;
  section: (Section & { id: string }) | null;
  attendance: StudentAttendanceHistory | null;
  message?: string;
}

interface TimetableResponse {
  course?: Course | null;
  timing?: CourseYearTiming | null;
  slots?: TimetableSlotRow[];
}

function getTodayDayOfWeek(): DayOfWeek {
  const dayIndex = new Date().getDay();
  const map: Record<number, DayOfWeek> = { 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };
  return map[dayIndex] ?? "MON";
}

// Student's own dashboard home - profile summary, overall attendance
// standing, and today's class schedule (the daily-schedule card mirrors
// (dashboard)/class-leader/page.tsx's "Class Schedule" section, adapted to a
// student's own section rather than a class-rep's bound one).
export default function StudentDashboardPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [timing, setTiming] = useState<CourseYearTiming | null>(null);
  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/student/me").then((r) => r.json() as Promise<MeResponse>),
      fetch("/api/college/student/me/timetable").then((r) => r.json() as Promise<TimetableResponse>),
    ])
      .then(([meRes, ttRes]) => {
        setMe(meRes);
        setCourse(ttRes.course ?? null);
        setTiming(ttRes.timing ?? null);
        setSlots(ttRes.slots ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load your dashboard" }))
      .finally(() => setIsLoading(false));
  }, []);

  const todayDay = useMemo(() => getTodayDayOfWeek(), []);
  const daysWithClasses = useMemo(() => {
    const byDay = new Set(slots.map((s) => s.day));
    return resolveTimetableDays(null, byDay).filter((d) => byDay.has(d));
  }, [slots]);
  const activeDay = daysWithClasses.includes(todayDay) ? todayDay : null;

  const daySlots = useMemo(
    () => (activeDay ? slots.filter((s) => s.day === activeDay).sort((a, b) => a.periodNumber - b.periodNumber) : []),
    [slots, activeDay]
  );

  const periodTimingsMap = useMemo(() => {
    const map = new Map<number, { startTime: string; endTime: string }>();
    if (timing?.periods) for (const p of timing.periods) map.set(p.period, { startTime: p.startTime, endTime: p.endTime });
    return map;
  }, [timing]);

  const student = me?.student;
  const section = me?.section;
  const attendance = me?.attendance;
  const overallShort = attendance ? isShortageByPercent(attendance.total.percent, DEFAULT_SHORTAGE_THRESHOLD) : false;

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground break-words">
          {student ? `Welcome, ${student.name.split(" ")[0]}` : "My Dashboard"}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5 break-words">
          {student && section
            ? `${student.rollNumber} · ${formatAcademicShortNotation({ year: section.year, courseName: course?.name, courseCode: course?.code, sectionName: section.name })}`
            : "Your profile, timetable and attendance"}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="h-24 rounded-xl border bg-muted/30 animate-pulse" />
          <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
        </div>
      ) : !student ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <h3 className="font-semibold text-base">Login Not Linked</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {me?.message ?? "Your login is not linked to a student record yet. Please contact your College Office."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attendance</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">
                    {attendance ? formatPercent(attendance.total.percent) : "—"}
                  </p>
                </div>
                {attendance && attendance.subjects.length > 0 && (
                  <Badge variant={overallShort ? "destructive" : "default"} className="gap-1.5 shrink-0">
                    {overallShort ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                    {overallShort ? "Below threshold" : "On track"}
                  </Badge>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Today&rsquo;s Classes</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">{daySlots.length}</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/student/timetable">
                    <CalendarDays className="h-4 w-4 mr-1.5" /> Full Timetable
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          {!section ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No class/section is linked to your record yet - your timetable and today&rsquo;s schedule will appear once one is.
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-xs border-border/80 overflow-hidden">
              <CardHeader className="p-4 sm:p-5 border-b bg-card/60">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary shrink-0" />
                  <span>Today&rsquo;s Schedule</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                {daySlots.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No classes scheduled for today.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {daySlots.map((slot) => {
                      const periodTime = periodTimingsMap.get(slot.periodNumber);
                      const isSub = Boolean(slot.substituteFacultyName);
                      const isLab = slot.subjectType === "PRACTICAL";
                      return (
                        <div
                          key={slot.id}
                          className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 ${
                            isSub
                              ? "bg-amber-500/5 border-amber-500/30 dark:bg-amber-950/20"
                              : isLab
                              ? "bg-emerald-500/5 border-emerald-500/20 dark:bg-emerald-950/20"
                              : "bg-card hover:bg-muted/15 border-border"
                          }`}
                        >
                          <p className="text-xs font-semibold text-muted-foreground">
                            Period {slot.periodNumber}
                            {periodTime && ` · ${formatTime12h(periodTime.startTime)} – ${formatTime12h(periodTime.endTime)}`}
                          </p>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-foreground leading-snug line-clamp-2">
                              {slot.subjectName}
                              {slot.labBatch && <span className="font-normal text-muted-foreground"> · {slot.labBatch}</span>}
                            </p>
                            {(slot.subjectCode || slot.shortCode) && (
                              <p className="text-xs font-mono text-muted-foreground mt-0.5">{slot.subjectCode || slot.shortCode}</p>
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Link href="/student/attendance">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <TrendingUp className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium text-sm">My Attendance</p>
                    <p className="text-xs text-muted-foreground">Subject-wise breakdown</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/student/timetable">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium text-sm">My Timetable</p>
                    <p className="text-xs text-muted-foreground">Full weekly schedule</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/student/library">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium text-sm">My Library</p>
                    <p className="text-xs text-muted-foreground">Borrowed books & reservations</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/student/documents">
              <Card className="hover:bg-muted/20 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-medium text-sm">My Documents</p>
                    <p className="text-xs text-muted-foreground">Certificates on file</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
