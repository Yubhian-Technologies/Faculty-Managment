"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, FileBarChart } from "lucide-react";
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

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin/departments">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <Badge variant="outline" className="text-primary border-primary/30 text-[10px] font-semibold px-1.5 py-0 mb-1">
              Location Staff Admin
            </Badge>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <FileBarChart className="h-5 w-5 text-primary" />
              <span>Attendance Reports</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-staff attendance summary for a date range, with department and shift filters.
            </p>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card p-3 rounded-xl border shadow-xs">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">From</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">To</Label>
          <Input type="date" value={to} min={from} max={istDateKey()} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Department</Label>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Shift</Label>
          <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Shifts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Shifts</SelectItem>
              {shifts.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Report Table ── */}
      <DataTable<StaffReportRow>
        data={rows}
        isLoading={isLoading}
        keyExtractor={(r) => r.staffId}
        searchPlaceholder="Search by staff name, role, department..."
        searchKeys={["staffName", "role", "departmentName"]}
        csvFilename={`staff-attendance-report_${from}_to_${to}`}
        emptyTitle="No attendance records for this range"
        columns={[
          { key: "staffName", header: "Staff" },
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
                className={
                  r.attendancePercent >= 90
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : r.attendancePercent >= 75
                      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                      : "bg-red-500/10 text-red-600 border-red-500/20"
                }
              >
                {r.attendancePercent}%
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}
