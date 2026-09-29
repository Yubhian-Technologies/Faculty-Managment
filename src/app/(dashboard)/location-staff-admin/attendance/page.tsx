"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  FileBarChart,
  Clock,
  Phone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GoogleSearchInput } from "@/components/shared/GoogleSearchInput";
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
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                Attendance Monitoring
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Campus-Wide Roster
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Location Staff Attendance</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Live campus attendance tracking, punch records, and department shift monitoring.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button asChild size="default" className="h-10 gap-2 text-xs font-semibold rounded-full px-4 bg-primary text-primary-foreground shadow-xs hover:shadow">
            <Link href="/location-staff-admin/attendance/shift">
              <ClipboardCheck className="h-4 w-4" />
              <span>Shift Attendance</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-10 gap-1.5 text-xs font-semibold rounded-full px-4 border-border/60">
            <Link href="/location-staff-admin/reports">
              <FileBarChart className="h-3.5 w-3.5" />
              <span>Reports</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={loadAttendance} className="h-10 gap-1.5 text-xs font-semibold rounded-full px-4 border-border/60">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Date Navigator & Filter ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/80 backdrop-blur-sm p-4 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeDateByDays(-1)} className="h-9 w-9 rounded-full border-border/60">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 rounded-full border border-border/50 text-xs font-semibold">
            <CalendarIcon className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono">{date}</span>
          </div>
          <Button variant="outline" size="icon" onClick={() => changeDateByDays(1)} className="h-9 w-9 rounded-full border-border/60">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(istDateKey())} className="h-8 text-xs text-primary px-3 rounded-full font-semibold hover:bg-primary/10">
              Today
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-10 text-xs w-52 sm:w-60 rounded-full border-border/60 bg-muted/30 focus:bg-background">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
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
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-center text-xs">
          <div className="bg-card p-3.5 rounded-2xl border border-border/60 shadow-xs">
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Total Staff</span>
            <span className="text-xl font-bold text-foreground mt-0.5 block">{summary.total}</span>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 p-3.5 rounded-2xl shadow-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider block">Present</span>
            <span className="text-xl font-bold mt-0.5 block text-emerald-600 dark:text-emerald-400">{summary.present}</span>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 p-3.5 rounded-2xl shadow-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider block">Late</span>
            <span className="text-xl font-bold mt-0.5 block text-amber-600 dark:text-amber-400">{summary.late ?? 0}</span>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 p-3.5 rounded-2xl shadow-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider block">Absent</span>
            <span className="text-xl font-bold mt-0.5 block text-red-600 dark:text-red-400">{summary.absent}</span>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 p-3.5 rounded-2xl shadow-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider block">Half Day</span>
            <span className="text-xl font-bold mt-0.5 block text-blue-600 dark:text-blue-400">{summary.halfDay}</span>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 p-3.5 rounded-2xl shadow-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider block">Leave</span>
            <span className="text-xl font-bold mt-0.5 block text-purple-600 dark:text-purple-400">{summary.onLeave}</span>
          </div>
        </div>
      )}

      {/* ── Search Bar ── */}
      <div className="w-full">
        <GoogleSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search attendance by staff name, department, role, phone..."
        />
      </div>

      {/* ── Attendance Roster Table / Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredRoster.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <div className="h-14 w-14 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto mb-3">
            <ClipboardCheck className="h-7 w-7 opacity-70" />
          </div>
          <h3 className="font-bold text-foreground text-base">No attendance records found</h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            No check-in activity registered for this date and department selection.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoster.map(({ staff, attendance }) => (
            <Card key={staff.id} className="rounded-3xl border-border/60 shadow-xs hover:shadow-md hover:border-primary/40 transition-all duration-200 bg-card overflow-hidden">
              <CardContent className="p-5 space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 font-bold text-primary text-sm shadow-xs">
                      {staff.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover rounded-2xl" />
                      ) : (
                        staff.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-foreground truncate">{staff.name}</h4>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {staff.role}
                      </p>
                    </div>
                  </div>

                  <div>
                    {attendance?.status === "PRESENT" && !attendance?.isLate && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-2.5 py-0.5 rounded-full">
                        Present
                      </Badge>
                    )}
                    {(attendance?.status === "LATE" || attendance?.isLate) && (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] px-2.5 py-0.5 rounded-full">
                        Late
                      </Badge>
                    )}
                    {attendance?.status === "ABSENT" && (
                      <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px] px-2.5 py-0.5 rounded-full">
                        Absent
                      </Badge>
                    )}
                    {attendance?.status === "HALF_DAY" && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-2.5 py-0.5 rounded-full">
                        Half Day
                      </Badge>
                    )}
                    {attendance?.status === "ON_LEAVE" && (
                      <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px] px-2.5 py-0.5 rounded-full">
                        Leave
                      </Badge>
                    )}
                    {attendance?.isEmergencyDuty && (
                      <Badge className="bg-amber-500/15 text-amber-700 text-[10px] px-2 py-0.5 font-semibold rounded-full">
                        🚨 Emergency
                      </Badge>
                    )}
                    {!attendance?.status && (
                      <Badge variant="outline" className="text-muted-foreground text-[10px] px-2 py-0.5 rounded-full bg-muted/40">
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-muted/30 border border-border/40 text-xs space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Department:</span>
                    <span className="font-semibold text-foreground truncate max-w-[150px]">
                      {staff.departmentName}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border/40 text-[11px]">
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Check-In:</span>
                      <strong className="font-mono text-foreground text-xs">{attendance?.checkInTime || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Check-Out:</span>
                      <strong className="font-mono text-foreground text-xs">{attendance?.checkOutTime || "—"}</strong>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between text-xs border-t border-border/40">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3 text-primary" />
                    <span>{staff.contactNumber}</span>
                  </span>

                  <Button asChild size="sm" variant="ghost" className="h-7 text-xs font-semibold text-primary hover:bg-primary/10 rounded-full px-2.5">
                    <Link href={`/location-staff-admin/staff/${staff.id}`}>
                      Profile →
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

