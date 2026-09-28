"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  UsersRound,
  ClipboardCheck,
  Plus,
  UserCheck,
  Clock,
  ArrowRightLeft,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Calendar,
  FileBarChart,
  UserPlus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { istDateKey } from "@/lib/attendance/istTime";
import type { LocationDepartment } from "@/types/locationStaff";

export default function LocationStaffAdminDashboard() {
  const user = useAuthStore((s) => s.user);

  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [totalStaff, setTotalStaff] = useState<number>(0);
  const [attendanceSummary, setAttendanceSummary] = useState({
    total: 0,
    present: 0,
    late: 0,
    absent: 0,
    halfDay: 0,
    onLeave: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    const today = istDateKey();

    Promise.all([
      fetch(`/api/location/departments`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => {
          if (!isCancelled) setDepartments(d.departments ?? []);
        }),
      fetch(`/api/location/staff?status=ACTIVE`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setTotalStaff((d.staff ?? []).length);
        }),
      fetch(`/api/location/staff-attendance?date=${today}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ summary: null })))
        .then((d) => {
          if (!isCancelled && d.summary) setAttendanceSummary(d.summary);
        }),
    ]).finally(() => {
      if (!isCancelled) setIsLoading(false);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const assignedHeadsCount = departments.filter((d) => d.headUid || d.deptHeadUid).length;
  const attendanceRate =
    totalStaff > 0 ? Math.round((attendanceSummary.present / totalStaff) * 100) : 0;

  return (
    <div className="space-y-6 pb-20 md:pb-8 max-w-7xl mx-auto">
      {/* ── Google Cloud / Workspace Style Welcome Banner ── */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-card via-card to-primary/5 border border-border/60 shadow-xs overflow-hidden">
        {/* Subtle Decorative Circle */}
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/5 pointer-events-none blur-2xl" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Head of Location Staff
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>{istDateKey()}</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Campus Staff Operations
              {user?.name ? <span className="font-normal text-muted-foreground"> · {user.name}</span> : ""}
            </h1>

            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Real-time oversight across campus departments, staff rosters, shift scheduling, and daily attendance tracking.
            </p>
          </div>

          {/* Quick Action Floating Pills */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-full h-10 px-4 text-xs font-semibold gap-1.5 bg-card/80 hover:bg-muted/60 border-border/80 shadow-xs"
            >
              <Link href="/location-staff-admin/shifts">
                <Clock className="h-4 w-4 text-primary" />
                <span>Shifts & Rosters</span>
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-full h-10 px-4 text-xs font-semibold gap-1.5 bg-card/80 hover:bg-muted/60 border-border/80 shadow-xs"
            >
              <Link href="/location-staff-admin/attendance/reports">
                <FileBarChart className="h-4 w-4 text-emerald-600" />
                <span>Reports</span>
              </Link>
            </Button>

            <Button
              asChild
              size="sm"
              className="rounded-full h-10 px-5 text-xs font-semibold gap-2 shadow-xs hover:shadow-md transition-all"
            >
              <Link href="/location-staff-admin/departments/new">
                <Plus className="h-4 w-4" />
                <span>New Department</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Metric Cards (Google Analytics Style) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Departments */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 shadow-xs hover:shadow-md transition-all duration-200 group">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Departments
              </span>
              <div className="h-10 w-10 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold transition-transform group-hover:scale-105">
                <Building2 className="h-5 w-5" />
              </div>
            </div>
            <p className="text-3xl font-extrabold tracking-tight text-foreground mt-3">
              {departments.length}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300">
                {assignedHeadsCount} Appointed Heads
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Total Active Staff */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 shadow-xs hover:shadow-md transition-all duration-200 group">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Active Staff
              </span>
              <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold transition-transform group-hover:scale-105">
                <UsersRound className="h-5 w-5" />
              </div>
            </div>
            <p className="text-3xl font-extrabold tracking-tight text-foreground mt-3">
              {totalStaff}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                Across {departments.length} Campus Units
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Today's Present */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 shadow-xs hover:shadow-md transition-all duration-200 group">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                Present Today
              </span>
              <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold transition-transform group-hover:scale-105">
                <UserCheck className="h-5 w-5" />
              </div>
            </div>
            <p className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400 mt-3">
              {attendanceSummary.present}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {attendanceRate}% On-Duty Rate
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Late / Absent */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 shadow-xs hover:shadow-md transition-all duration-200 group">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                Exceptions
              </span>
              <div className="h-10 w-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold transition-transform group-hover:scale-105">
                <ClipboardCheck className="h-5 w-5" />
              </div>
            </div>
            <p className="text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400 mt-3">
              {attendanceSummary.late + attendanceSummary.absent + attendanceSummary.onLeave}
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {attendanceSummary.late} Late • {attendanceSummary.absent} Absent
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Operational Modules (Google Workspace Bento Grid) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Campus Operations Hub</span>
          </h2>
          <span className="text-xs text-muted-foreground">Select a module to manage</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. Departments & Staff Hub */}
          <Link
            href="/location-staff-admin/departments"
            className="group rounded-2xl p-5 bg-card/70 hover:bg-card border border-border/50 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Building2 className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                  {departments.length} Units
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                Departments Hub
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Dedicated department hubs with Department Heads, Staff rosters, Shift schedules, and Live attendance.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
              <span>Explore Departments</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 2. Shifts & Rosters */}
          <Link
            href="/location-staff-admin/shifts"
            className="group rounded-2xl p-5 bg-card/70 hover:bg-card border border-border/50 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Clock className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                  Campus-Wide
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                Shifts & Roster Rotation
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Configure reusable shifts across departments, set start/end timings, grace periods, and rotate staff.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
              <span>Manage Shifts</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 3. Attendance Reports */}
          <Link
            href="/location-staff-admin/attendance/reports"
            className="group rounded-2xl p-5 bg-card/70 hover:bg-card border border-border/50 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <FileBarChart className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                  CSV Export
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                Attendance Reports & Export
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Analyze historical attendance, calculate attendance percentages, and download formatted CSV reports.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
              <span>View Reports</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 4. Register Staff Member */}
          <Link
            href="/location-staff-admin/staff/new"
            className="group rounded-2xl p-5 bg-card/70 hover:bg-card border border-border/50 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <UserPlus className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                  + Add Staff
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                Staff Registration
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Register new campus personnel with live webcam photo capture, Aadhaar validation, and shift assignments.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
              <span>Add Staff Member</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 5. Shift-Wise Live Attendance */}
          <Link
            href="/location-staff-admin/attendance/shift"
            className="group rounded-2xl p-5 bg-card/70 hover:bg-card border border-border/50 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                  Live View
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                Shift-Wise Attendance
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Take attendance focused per shift with automated late arrival and out-of-time checkout detection.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs font-semibold text-primary">
              <span>Open Shift Roster</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 6. Security & Multi-Tenancy */}
          <div className="rounded-2xl p-5 bg-muted/20 border border-border/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Protected
                </span>
              </div>
              <h3 className="font-bold text-base text-foreground">
                Location Tenancy Shield
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Atomic transaction operations and location-isolated Firestore security guarding all departmental records.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border/40 text-[11px] text-muted-foreground font-medium">
              Enterprise Grade • Verified Multi-Tenant
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
