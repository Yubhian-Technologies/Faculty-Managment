"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
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
  leaveTaken: number;
  leaveBalance: number;
  leaveType: string;
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
  const [isLoadingData, setIsLoadingData] = useState(true);

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

  const loadReport = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (selectedDeptId !== "ALL") params.set("departmentId", selectedDeptId);
      if (selectedShiftId !== "ALL") params.set("shiftId", selectedShiftId);

      const attRes = await fetch(`/api/location/staff-attendance/report?${params.toString()}`);
      let attRows: StaffReportRow[] = [];
      if (attRes.ok) {
        const d = await attRes.json() as { rows: StaffReportRow[] };
        attRows = d.rows ?? [];
      }

      const leaveRes = await fetch(`/api/location/leave?${params.toString()}`);
      let leaveData: { leaveRequests: Array<{ staffId: string; staffName: string; leaveType: string }> } = { leaveRequests: [] };
      if (leaveRes.ok) leaveData = await leaveRes.json();

      const staffRes = await fetch(`/api/location/staff?${params.toString()}`);
      let staffList: Array<{ id: string; name: string; leaveBalance?: number; leaveTaken?: number }> = [];
      if (staffRes.ok) {
        const s = await staffRes.json() as { staff: Array<{ id: string; name: string; leaveBalance?: number; leaveTaken?: number }> };
        staffList = s.staff ?? [];
      }

      const leaveByStaff = new Map<string, number>();
      const leaveTypeByStaff = new Map<string, string>();
      for (const lr of leaveData.leaveRequests) {
        leaveByStaff.set(lr.staffId, (leaveByStaff.get(lr.staffId) ?? 0) + 1);
        leaveTypeByStaff.set(lr.staffId, lr.leaveType);
      }

      const merged = attRows.map((row) => {
        const staffInfo = staffList.find((s) => s.id === row.staffId);
        return { ...row, leaveTaken: leaveByStaff.get(row.staffId) ?? 0, leaveBalance: staffInfo?.leaveBalance ?? 0, leaveType: leaveTypeByStaff.get(row.staffId) ?? "CL" };
      });

      for (const lr of leaveData.leaveRequests) {
        if (!merged.find((r) => r.staffId === lr.staffId)) {
          const staffInfo = staffList.find((s) => s.id === lr.staffId);
          merged.push({ staffId: lr.staffId, staffName: lr.staffName ?? staffInfo?.name ?? lr.staffId, role: "-", departmentName: "", shiftName: "-", present: 0, absent: 0, halfDay: 0, onLeave: 0, marked: 0, attendancePercent: 0, leaveTaken: 1, leaveBalance: staffInfo?.leaveBalance ?? 0, leaveType: lr.leaveType });
        }
      }

      setRows(merged);
    } catch {
      toast({ variant: "destructive", title: "Failed to load report" });
    } finally {
      setIsLoading(false);
      setIsLoadingData(false);
    }
  }, [from, to, selectedDeptId, selectedShiftId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const summary = useMemo(() => {
    if (rows.length === 0) return { totalStaff: 0, avgPercent: 0, totalPresent: 0, totalAbsent: 0, totalLeave: 0 };
    return { totalStaff: rows.length, avgPercent: Math.round(rows.reduce((acc, r) => acc + r.attendancePercent, 0) / rows.length), totalPresent: rows.reduce((acc, r) => acc + r.present, 0), totalAbsent: rows.reduce((acc, r) => acc + r.absent, 0), totalLeave: rows.reduce((acc, r) => acc + (r.leaveTaken ?? 0), 0) };
  }, [rows]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link href="/location-staff-admin/attendance"><ArrowLeft className="h-5 w-5 text-foreground" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">Merged Reports</Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">Attendance + Leave + Pay</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Campus Staff Reports</span>
            </h1>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadReport} disabled={isLoading}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Load</Button>
      </div>

      <div className="space-y-3 bg-card/80 backdrop-blur-sm p-4 sm:p-5 rounded-3xl border border-border/60 shadow-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">From</Label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">To</Label>
            <Input type="date" value={to} min={from} max={istDateKey()} onChange={(e) => setTo(e.target.value)} className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">Department</Label>
            <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
              <SelectTrigger className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All Departments</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">Shift</Label>
            <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
              <SelectTrigger className="h-10 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background"><SelectValue placeholder="All Shifts" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All Shifts</SelectItem>{shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-border/40 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-medium">Quick:</span>
          <Button variant="outline" size="sm" className="h-8 text-xs rounded-full px-3" onClick={() => { setFrom(istDateKey()); setTo(istDateKey()); }}>Today</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs rounded-full px-3" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setFrom(d.toISOString().split("T")[0]); setTo(istDateKey()); }}>7 Days</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs rounded-full px-3" onClick={() => { setFrom(firstOfMonth()); setTo(istDateKey()); }}>This Month</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs"><span className="text-[11px] text-muted-foreground">Staff</span><p className="text-2xl font-bold">{summary.totalStaff}</p></div>
        <div className="bg-card p-4 rounded-2xl border border-border/60 shadow-xs"><span className="text-[11px] text-muted-foreground">Avg Attendance</span><p className="text-2xl font-bold text-primary">{summary.avgPercent}%</p></div>
        <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20"><span className="text-[11px] text-emerald-700">Present</span><p className="text-2xl font-bold text-emerald-600">{summary.totalPresent}</p></div>
        <div className="bg-red-500/10 p-4 rounded-2xl border border-red-500/20"><span className="text-[11px] text-red-700">Absent</span><p className="text-2xl font-bold text-red-600">{summary.totalAbsent}</p></div>
        <div className="bg-purple-500/10 p-4 rounded-2xl border border-purple-500/20"><span className="text-[11px] text-purple-700">Leave</span><p className="text-2xl font-bold text-purple-600">{summary.totalLeave}</p></div>
      </div>

      {isLoadingData ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /> Loading merged report...</div>
      ) : (
        <div className="rounded-3xl border border-border/60 shadow-xs overflow-hidden bg-card p-4 sm:p-6">
          <DataTable<StaffReportRow>
            data={rows} isLoading={isLoading} keyExtractor={(r) => r.staffId}
            searchPlaceholder="Search by staff name..." searchKeys={["staffName", "role", "departmentName"]}
            csvFilename={`merged-report_${from}_to_${to}`} emptyTitle="No data" paginate defaultPageSize={10}
            columns={[
              { key: "staffName", header: "Staff Member" },
              { key: "departmentName", header: "Department" },
              { key: "role", header: "Role" },
              { key: "shiftName", header: "Shift" },
              { key: "present", header: "Present" },
              { key: "absent", header: "Absent" },
              { key: "leaveTaken", header: "Leave" },
              { key: "leaveBalance", header: "Leave Bal", render: (r) => r.leaveBalance ?? 0 },
              { key: "marked", header: "Days Marked" },
              { key: "attendancePercent", header: "Attendance %", render: (r) => <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${(r.attendancePercent as number) >= 90 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : (r.attendancePercent as number) >= 75 ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-red-500/10 text-red-600 border-red-500/20"}`}>{r.attendancePercent}%</Badge> },
            ]}
          />
        </div>
      )}
    </div>
  );
}
