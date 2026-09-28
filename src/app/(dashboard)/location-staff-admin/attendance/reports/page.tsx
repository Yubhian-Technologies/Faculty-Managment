"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, FileBarChart, Download, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { istDateKey } from "@/lib/attendance/istTime";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

interface StaffReportRow extends Record<string, unknown> {
  staffId: string;
  staffName: string;
  role: string;
  departmentName: string;
  shiftName: string;
  present: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  marked: number;
  attendancePercent: number;
}

function firstOfMonth(): string {
  const today = istDateKey();
  const [y, m] = today.split("-");
  return `${y}-${m}-01`;
}

export default function StaffAttendanceReportsPage() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(istDateKey);
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("ALL");
  const [selectedShiftId, setSelectedShiftId] = useState("ALL");
  const [rows, setRows] = useState<StaffReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/location/departments`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
    fetch(`/api/location/shifts`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
      .then((d) => setShifts(d.shifts ?? []))
      .catch(() => {});
  }, []);

  const loadReport = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams({ from, to });
    if (selectedDeptId !== "ALL") params.set("departmentId", selectedDeptId);
    if (selectedShiftId !== "ALL") params.set("shiftId", selectedShiftId);

    fetch(`/api/location/staff-attendance/report?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.rows ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load attendance report" }))
      .finally(() => setIsLoading(false));
  }, [from, to, selectedDeptId, selectedShiftId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const summary = useMemo(() => {
    if (rows.length === 0) return { totalStaff: 0, avgPercent: 0, totalPresent: 0, totalAbsent: 0 };
    const totalStaff = rows.length;
    const avgPercent = Math.round(rows.reduce((acc, r) => acc + r.attendancePercent, 0) / totalStaff);
    const totalPresent = rows.reduce((acc, r) => acc + r.present, 0);
    const totalAbsent = rows.reduce((acc, r) => acc + r.absent, 0);
    return { totalStaff, avgPercent, totalPresent, totalAbsent };
  }, [rows]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link href="/location-staff-admin/attendance">
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                Attendance Analytics
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Historical Records & Export
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Campus Staff Attendance Reports</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Comprehensive attendance breakdown by date range, department, and work shift.
            </p>
          </div>
        </div>
      </div>

      {/* ── Google Filters Bar ── */}
      <div className="space-y-3 bg-card/80 backdrop-blur-sm p-4 sm:p-5 rounded-3xl border border-border/60 shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">From Date</Label>
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">To Date</Label>
            <Input
              type="date"
              value={to}
              min={from}
              max={istDateKey()}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">Department</Label>
            <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
              <SelectTrigger className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl">
                <SelectItem value="ALL">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">Shift</Label>
            <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
              <SelectTrigger className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background">
                <SelectValue placeholder="All Shifts" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl">
                <SelectItem value="ALL">All Shifts</SelectItem>
                {shifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Quick Date Range Preset Pills */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/40 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-medium">Quick Presets:</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold rounded-full px-3.5 border-border/60"
            onClick={() => {
              setFrom(istDateKey());
              setTo(istDateKey());
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold rounded-full px-3.5 border-border/60"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 7);
              setFrom(d.toISOString().split("T")[0]);
              setTo(istDateKey());
            }}
          >
            Past 7 Days
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold rounded-full px-3.5 border-border/60"
            onClick={() => {
              setFrom(firstOfMonth());
              setTo(istDateKey());
            }}
          >
            This Month
          </Button>
        </div>
      </div>

      {/* ── Summary Stats Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Staff Members</span>
          <p className="text-2xl font-bold text-foreground mt-0.5">{summary.totalStaff}</p>
        </div>
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Average Attendance</span>
          <p className="text-2xl font-bold text-primary mt-0.5">{summary.avgPercent}%</p>
        </div>
        <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 shadow-xs">
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">Total Present Days</span>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{summary.totalPresent}</p>
        </div>
        <div className="bg-red-500/10 p-4 rounded-2xl border border-red-500/20 shadow-xs">
          <span className="text-[11px] text-red-700 dark:text-red-400 font-medium">Total Absent Days</span>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-0.5">{summary.totalAbsent}</p>
        </div>
      </div>

      {/* ── Report Table ── */}
      <div className="rounded-3xl border border-border/60 shadow-xs overflow-hidden bg-card p-4 sm:p-6">
        <DataTable<StaffReportRow>
          data={rows}
          isLoading={isLoading}
          keyExtractor={(r) => r.staffId}
          searchPlaceholder="Search report by staff name, role, department..."
          searchKeys={["staffName", "role", "departmentName"]}
          csvFilename={`staff-attendance-report_${from}_to_${to}`}
          emptyTitle="No attendance records for this range"
          columns={[
            { key: "staffName", header: "Staff Member" },
            { key: "departmentName", header: "Department" },
            { key: "role", header: "Role" },
            { key: "shiftName", header: "Shift" },
            { key: "present", header: "Present" },
            { key: "absent", header: "Absent" },
            { key: "halfDay", header: "Half Day" },
            { key: "onLeave", header: "Leave" },
            { key: "marked", header: "Days Marked" },
            {
              key: "attendancePercent",
              header: "Attendance %",
              render: (r) => (
                <Badge
                  variant="outline"
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    r.attendancePercent >= 90
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : r.attendancePercent >= 75
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        : "bg-red-500/10 text-red-600 border-red-500/20"
                  }`}
                >
                  {r.attendancePercent}%
                </Badge>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

