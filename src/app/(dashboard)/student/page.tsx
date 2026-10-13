"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  TrendingUp,
  ShieldCheck,
  BookOpen,
  FileText,
  FileCheck,
  UserCircle,
  GraduationCap,
  ChevronRight,
  MapPin,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { toast } from "@/hooks/useToast";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";

interface TodayPeriod {
  id: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  code: string;
  subjectName: string;
  faculty: string;
  isSubstitute: boolean;
  room: string;
  labBatch: string;
}

interface TodayResponse {
  student: { name: string; rollNumber: string } | null;
  message?: string;
  date?: string;
  day?: string | null;
  hasSection?: boolean;
  hasTiming?: boolean;
  className?: string;
  periods?: TodayPeriod[];
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

const ACADEMIC_MODULES = [
  { label: "My Timetable", description: "Weekly period schedule", href: "/student/timetable", icon: CalendarDays, color: "bg-blue-50 text-blue-600" },
  { label: "My Attendance", description: "Attendance records & percentage", href: "/student/attendance", icon: TrendingUp, color: "bg-emerald-50 text-emerald-600" },
  { label: "Permissions", description: "On-Duty & permission requests", href: "/student/permissions", icon: ShieldCheck, color: "bg-amber-50 text-amber-600" },
];

const RESOURCE_MODULES = [
  { label: "Library Catalog", description: "Books, loans & reservations", href: "/student/library", icon: BookOpen, color: "bg-purple-50 text-purple-600" },
  { label: "Documents", description: "Notes, syllabus & resources", href: "/student/documents", icon: FileText, color: "bg-indigo-50 text-indigo-600" },
  { label: "Certificates", description: "Bonafide & certificate requests", href: "/student/certificates", icon: FileCheck, color: "bg-teal-50 text-teal-600" },
  { label: "My Profile", description: "Personal & academic details", href: "/student/profile", icon: UserCircle, color: "bg-slate-100 text-slate-700" },
];

export default function StudentDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);

  const visibleAcademicModules = ACADEMIC_MODULES.filter((m) => !isHidden(m.href));
  const visibleResourceModules = RESOURCE_MODULES.filter((m) => !isHidden(m.href));

  useEffect(() => {
    fetch("/api/college/student/me/today")
      .then((r) => r.json() as Promise<TodayResponse>)
      .then(setData)
      .catch(() => toast({ variant: "destructive", title: "Failed to load dashboard" }))
      .finally(() => setIsLoading(false));
  }, []);

  const student = data?.student;
  const periods = data?.periods ?? [];
  const firstName = student?.name.trim().split(/\s+/)[0] ?? user?.name?.trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Student Dashboard"}
        description={student ? [student.rollNumber, data?.className].filter(Boolean).join(" · ") : "Student Portal"}
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : !student ? (
        <Card className="border border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {data?.message ?? "Your login is not linked to a student record yet. Please contact your College Office."}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Quick Overview Stats Bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="border shadow-xs">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Today's Classes</p>
                  <p className="text-base sm:text-lg font-bold text-foreground">{periods.length} {periods.length === 1 ? "Period" : "Periods"}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-xs">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-amber-50 text-amber-600">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Permissions</p>
                  <p className="text-base sm:text-lg font-bold text-foreground">On Duty</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-xs">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-teal-50 text-teal-600">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Section</p>
                  <p className="text-xs sm:text-sm font-semibold text-foreground truncate">{data?.className || "Enrolled"}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-xs">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-purple-50 text-purple-600">
                  <UserCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Roll Number</p>
                  <p className="text-xs sm:text-sm font-semibold text-foreground truncate">{student.rollNumber}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Academics Modules */}
          {visibleAcademicModules.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Academics & Attendance</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {visibleAcademicModules.map((mod) => (
                  <Link key={mod.href} href={mod.href}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border border-border">
                      <CardContent className="p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${mod.color}`}>
                            <mod.icon className="h-5 w-5" />
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-foreground">{mod.label}</p>
                          <p className="text-xs text-muted-foreground">{mod.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Services & Resources Modules */}
          {visibleResourceModules.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Services & Resources</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {visibleResourceModules.map((mod) => (
                  <Link key={mod.href} href={mod.href}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border border-border">
                      <CardContent className="p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${mod.color}`}>
                            <mod.icon className="h-5 w-5" />
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-foreground">{mod.label}</p>
                          <p className="text-xs text-muted-foreground">{mod.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Today's Schedule Card */}
          <Card className="border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base font-semibold">Today's Schedule</CardTitle>
                {data?.date && <p className="text-xs text-muted-foreground mt-0.5">{longDate(data.date)}</p>}
              </div>
              <Badge variant="outline" className="text-xs font-normal rounded-md">
                {periods.length} {periods.length === 1 ? "Class" : "Classes"}
              </Badge>
            </CardHeader>
            <CardContent>
              {!data?.hasSection ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No class is linked to your record yet. Your schedule will appear here once assigned.
                </p>
              ) : !data.day ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No classes on Sunday.</p>
              ) : periods.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {data.hasTiming ? "No classes scheduled for today." : "Your timetable has not been set up yet."}
                </p>
              ) : (
                <ul className="divide-y divide-border border rounded-lg bg-card">
                  {periods.map((p) => (
                    <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3.5 sm:p-4">
                      <div className="w-full sm:w-28 shrink-0 flex sm:flex-col justify-between sm:justify-start text-xs text-muted-foreground border-b sm:border-b-0 pb-1 sm:pb-0">
                        <span className="font-medium text-foreground">Period {p.periodNumber}</span>
                        {p.startTime && p.endTime && (
                          <span className="mt-0.5 leading-snug">
                            {formatTime12h(p.startTime)} - {formatTime12h(p.endTime)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="break-words text-sm font-semibold text-foreground">{p.code}</p>
                          {p.labBatch && <Badge variant="secondary" className="text-[10px] font-normal rounded-md">{p.labBatch}</Badge>}
                          {p.isSubstitute && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-800 rounded-md">Substitute</Badge>}
                        </div>
                        {p.subjectName && p.subjectName !== p.code && (
                          <p className="break-words text-xs text-muted-foreground mt-0.5">{p.subjectName}</p>
                        )}
                        <p className="mt-1 break-words text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                          <span>{p.isSubstitute ? `Substitute: ${p.faculty}` : p.faculty || "Faculty not assigned"}</span>
                          {p.room && (
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              Room {p.room}
                            </span>
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
