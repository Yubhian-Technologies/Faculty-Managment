"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  ClipboardCheck,
  RefreshCw,
  FileBarChart,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { istDateKey } from "@/lib/attendance/istTime";
import type {
  LocationDepartment,
  LocationStaffMember,
  LocationStaffAttendanceRecord,
} from "@/types/locationStaff";

interface RosterItem {
  staff: LocationStaffMember;
  attendance: LocationStaffAttendanceRecord | null;
}

interface Summary {
  total: number;
  present: number;
  late?: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  unmarked: number;
  presentRate: number;
}

export default function LocationStaffAttendanceOverviewPage() {
  const [date, setDate] = useState<string>(() => istDateKey());
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("ALL");
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Load departments
  useEffect(() => {
    fetch(`/api/location/departments`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  // Load attendance
  const loadAttendance = useCallback(() => {
    const params = new URLSearchParams({ date });
    if (selectedDeptId !== "ALL") {
      params.set("departmentId", selectedDeptId);
    }

    fetch(`/api/location/staff-attendance?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setRoster(d.roster ?? []);
        setSummary(d.summary ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load attendance" }))
      .finally(() => setIsLoading(false));
  }, [date, selectedDeptId]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const changeDateByDays = (offset: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const current = new Date(y, m - 1, d);
    current.setDate(current.getDate() + offset);
    const ny = current.getFullYear();
    const nm = String(current.getMonth() + 1).padStart(2, "0");
    const nd = String(current.getDate()).padStart(2, "0");
    setDate(`${ny}-${nm}-${nd}`);
  };

  const isToday = date === istDateKey();

  // Filter roster
  const filteredRoster = useMemo(() => {
    if (!search.trim()) return roster;
    const q = search.toLowerCase().trim();
    return roster.filter(
      (r) =>
        r.staff.name.toLowerCase().includes(q) ||
        r.staff.departmentName?.toLowerCase().includes(q) ||
        r.staff.role?.toLowerCase().includes(q) ||
        r.staff.contactNumber.includes(q)
    );
  }, [roster, search]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Location Staff Attendance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Campus-wide daily attendance monitoring and check-in/out records.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
          <Button asChild size="sm" className="h-8 gap-1.5 text-xs font-semibold rounded-full shadow-xs">
            <Link href="/location-staff-admin/attendance/shift">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>Shift-Wise Attendance</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Link href="/location-staff-admin/attendance/reports">
              <FileBarChart className="h-3.5 w-3.5" />
              <span>Reports</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={loadAttendance} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Date Navigator & Filter ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card p-3 rounded-xl border shadow-xs">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => changeDateByDays(-1)} className="h-8 w-8 p-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-muted/40 rounded-lg border text-xs font-semibold">
            <CalendarIcon className="h-3.5 w-3.5 text-primary" />
            <span>{date}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => changeDateByDays(1)} className="h-8 w-8 p-0">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(istDateKey())} className="h-7 text-xs text-primary px-2 font-medium">
              Today
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-8 text-xs w-48 rounded-lg">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
          <div className="bg-card p-3 rounded-xl border">
            <span className="text-muted-foreground block text-[11px]">Total Staff</span>
            <span className="text-xl font-bold text-foreground mt-0.5 block">{summary.total}</span>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 p-3 rounded-xl">
            <span className="block text-[11px] font-medium">Present</span>
            <span className="text-xl font-bold mt-0.5 block">{summary.present}</span>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 p-3 rounded-xl">
            <span className="block text-[11px] font-medium">Late Check-In</span>
            <span className="text-xl font-bold mt-0.5 block">{summary.late ?? 0}</span>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 p-3 rounded-xl">
            <span className="block text-[11px] font-medium">Absent</span>
            <span className="text-xl font-bold mt-0.5 block">{summary.absent}</span>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 p-3 rounded-xl">
            <span className="block text-[11px] font-medium">Half Day</span>
            <span className="text-xl font-bold mt-0.5 block">{summary.halfDay}</span>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 p-3 rounded-xl">
            <span className="block text-[11px] font-medium">Leave</span>
            <span className="text-xl font-bold mt-0.5 block">{summary.onLeave}</span>
          </div>
        </div>
      )}

      {/* ── Search Bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search attendance by staff name, department, role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs rounded-xl bg-card"
        />
      </div>

      {/* ── Attendance Roster Table / Cards ── */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredRoster.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No attendance records found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRoster.map(({ staff, attendance }) => (
            <Card key={staff.id} className="border-border/80 shadow-xs">
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 font-bold text-primary text-xs">
                      {staff.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover rounded-full" />
                      ) : (
                        staff.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-foreground">{staff.name}</h4>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{staff.role}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {staff.departmentName} {staff.shiftName && `· ${staff.shiftName}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-border/50 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        In: <strong className="text-foreground">{attendance?.checkInTime || "—"}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        Out: <strong className="text-foreground">{attendance?.checkOutTime || "—"}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {attendance?.status === "PRESENT" && !attendance?.isLate && (
                        <Badge className="bg-emerald-600 text-white text-xs px-2 py-0.5">Present</Badge>
                      )}
                      {(attendance?.status === "LATE" || attendance?.isLate) && (
                        <Badge className="bg-amber-600 text-white text-xs px-2 py-0.5">Late</Badge>
                      )}
                      {attendance?.status === "ABSENT" && (
                        <Badge variant="destructive" className="text-xs px-2 py-0.5">Absent</Badge>
                      )}
                      {attendance?.status === "HALF_DAY" && (
                        <Badge className="bg-blue-600 text-white text-xs px-2 py-0.5">Half Day</Badge>
                      )}
                      {attendance?.status === "ON_LEAVE" && (
                        <Badge className="bg-purple-600 text-white text-xs px-2 py-0.5">Leave</Badge>
                      )}
                      {attendance?.isEmergencyDuty && (
                        <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0 font-semibold">
                          🚨 Emergency Duty
                        </Badge>
                      )}
                      {!attendance?.status && (
                        <Badge variant="outline" className="text-muted-foreground text-xs px-2 py-0.5">Pending</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
