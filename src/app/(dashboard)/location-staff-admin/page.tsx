"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  UsersRound,
  ClipboardCheck,
  Plus,
  UserCheck,
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
    absent: 0,
    halfDay: 0,
    onLeave: 0,
  });

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
    ]);

    return () => {
      isCancelled = true;
    };
  }, []);

  const assignedHeadsCount = departments.filter((d) => d.headUid).length;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card p-4 sm:p-5 rounded-xl border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-primary border-primary/30 text-xs font-semibold px-2 py-0.5">
              Head of Location Staff
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Location Staff Administration{user?.name ? ` · ${user.name}` : ""}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Campus-wide oversight of all location departments, department heads, staff rosters, and daily attendance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="rounded-full gap-1.5 shadow-sm text-xs font-semibold">
            <Link href="/location-staff-admin/departments">
              <Plus className="h-4 w-4" />
              <span>Create Department</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI Metrics Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Departments */}
        <Card className="border-border/80">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Departments</span>
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Building2 className="h-4 w-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{departments.length}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {assignedHeadsCount} with assigned Head
            </p>
          </CardContent>
        </Card>

        {/* Total Active Staff */}
        <Card className="border-border/80">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Total Staff</span>
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <UsersRound className="h-4 w-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{totalStaff}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Active employees</p>
          </CardContent>
        </Card>

        {/* Today's Present */}
        <Card className="border-border/80">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase">Present Today</span>
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <UserCheck className="h-4 w-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
              {attendanceSummary.present}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {totalStaff > 0 ? `${Math.round((attendanceSummary.present / totalStaff) * 100)}% attendance rate` : "No staff"}
            </p>
          </CardContent>
        </Card>

        {/* Absent / Leave */}
        <Card className="border-border/80">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase">Absent / Leave</span>
              <div className="h-8 w-8 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center">
                <ClipboardCheck className="h-4 w-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-2">
              {attendanceSummary.absent + attendanceSummary.onLeave}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {attendanceSummary.halfDay} on half-day
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Operational Modules ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Departments & Heads */}
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div>
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center mb-3">
                <Building2 className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-base text-foreground">Departments & Heads</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Create location departments (Security, Transport, Maintenance) and assign department heads.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {departments.length} Departments
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                <Link href="/location-staff-admin/departments">Manage</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Staff Directory & Profiles */}
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div>
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                <UsersRound className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-base text-foreground">Staff Directory</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Browse and filter all campus staff across departments, view full profiles, Aadhaar, and vouchers.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {totalStaff} Members
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                <Link href="/location-staff-admin/staff">Directory</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Daily Attendance Insights */}
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div>
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-base text-foreground">Attendance Overview</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Monitor real-time campus attendance, check-in timestamps, and department-level compliance.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Live Daily Sheet
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                <Link href="/location-staff-admin/attendance">Overview</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
