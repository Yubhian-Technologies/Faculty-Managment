"use client";

import { useEffect, useState } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { istDateKey } from "@/lib/attendance/istTime";
import type { LeaveRequest, LocationDepartment, LocationShift, LocationStaffMember } from "@/types/locationStaff";

type Tab = "attendance" | "leave" | "pay";

const TABS: { id: Tab; label: string }[] = [
  { id: "attendance", label: "Attendance Report" },
  { id: "leave", label: "Leave Report" },
  { id: "pay", label: "Pay Report" },
];

interface AttRow extends Record<string, unknown> {
  staffId: string; staffName: string; role: string; departmentName: string; shiftName: string;
  present: number; late: number; absent: number; halfDay: number; onLeave: number; marked: number; attendancePercent: number;
}
interface LeaveRow extends Record<string, unknown> {
  id: string; staffId: string; staffName: string; leaveType: string; startDate: string; endDate: string; status: string; reason: string;
}
interface PayRow extends Record<string, unknown> {
  staffId: string; staffName: string; departmentName: string; shiftName: string; role: string;
  payeeType: string; pf: string; esi: string; payableDays: number; lopDays: number; accountNumber: string; ifscCode: string;
}

const firstOfMonth = () => `${istDateKey().slice(0, 8)}01`;

async function getJson<T>(url: string, fallback: T): Promise<T> {
  const r = await fetch(url);
  return r.ok ? ((await r.json()) as T) : fallback;
}

export default function LocationReportsPage() {
  const [tab, setTab] = useState<Tab>("attendance");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(istDateKey);
  const [deptId, setDeptId] = useState("ALL");
  const [shiftId, setShiftId] = useState("ALL");
  const [staffId, setStaffId] = useState("ALL");
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [people, setPeople] = useState<LocationStaffMember[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null); // null = not loaded yet
  const [loadedTab, setLoadedTab] = useState<Tab>("attendance");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    getJson<{ departments: LocationDepartment[] }>("/api/location/departments", { departments: [] }).then((d) => setDepartments(d.departments ?? []));
    getJson<{ shifts: LocationShift[] }>("/api/location/shifts", { shifts: [] }).then((d) => setShifts(d.shifts ?? []));
  }, []);

  // Person picker only lists names for the chosen dept/shift; no report data is fetched here.
  useEffect(() => {
    const p = new URLSearchParams();
    if (deptId !== "ALL") p.set("departmentId", deptId);
    if (shiftId !== "ALL") p.set("shiftId", shiftId);
    setStaffId("ALL");
    getJson<{ staff: LocationStaffMember[] }>(`/api/location/staff?${p}`, { staff: [] }).then((d) => setPeople(d.staff ?? []));
  }, [deptId, shiftId]);

  // Switching tabs drops the previous tab's data so a stale table is never shown.
  function changeTab(t: Tab) {
    setTab(t);
    setRows(null);
  }

  async function load() {
    setIsLoading(true);
    try {
      const p = new URLSearchParams({ from, to });
      if (deptId !== "ALL") p.set("departmentId", deptId);
      if (shiftId !== "ALL") p.set("shiftId", shiftId);
      const person = (id: string) => staffId === "ALL" || id === staffId;

      if (tab === "leave") {
        const allowed = new Set(people.map((s) => s.id));
        const d = await getJson<{ leaveRequests: LeaveRequest[] }>(`/api/location/leave?${p}`, { leaveRequests: [] });
        setRows(
          d.leaveRequests
            .filter((l) => person(l.staffId) && (shiftId === "ALL" || allowed.has(l.staffId)))
            .map((l) => ({ id: l.id, staffId: l.staffId, staffName: l.staffName, leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate, status: l.status, reason: l.reason }))
        );
      } else {
        const att = (await getJson<{ rows: AttRow[] }>(`/api/location/staff-attendance/report?${p}`, { rows: [] })).rows.filter((r) => person(r.staffId));
        if (tab === "attendance") {
          setRows(att);
        } else {
          const byId = new Map(people.map((s) => [s.id, s]));
          setRows(
            att.map((r): PayRow => {
              const s = byId.get(r.staffId);
              return {
                staffId: r.staffId, staffName: r.staffName, departmentName: r.departmentName, shiftName: r.shiftName, role: r.role,
                payeeType: s?.payeeType ?? "-", pf: s?.pfEnabled ? "Yes" : "No", esi: s?.esiEnabled ? "Yes" : "No",
                payableDays: r.present + r.late + r.onLeave + r.halfDay * 0.5,
                lopDays: r.absent + r.halfDay * 0.5,
                accountNumber: s?.accountNumber ?? "-", ifscCode: s?.ifscCode ?? "-",
              };
            })
          );
        }
      }
      setLoadedTab(tab);
    } catch {
      toast({ variant: "destructive", title: "Failed to load report" });
    } finally {
      setIsLoading(false);
    }
  }

  const field = "h-10 text-xs rounded-full border-border/60 bg-muted/30";
  const file = `${loadedTab}-report_${from}_to_${to}`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      <div className="bg-card/90 p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Reports</h1>
        <p className="text-xs text-muted-foreground mt-1">Pick filters, click Load, then download as CSV.</p>
      </div>

      <div className="flex gap-2 flex-wrap" role="tablist">
        {TABS.map((t) => (
          <Button key={t.id} role="tab" aria-selected={tab === t.id} variant={tab === t.id ? "default" : "outline"} className="rounded-full h-9 text-xs" onClick={() => changeTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end bg-card/80 p-4 sm:p-5 rounded-3xl border border-border/60 shadow-xs">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">From</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={field} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">To</Label>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Department</Label>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger className={field}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All Departments</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Shift</Label>
          <Select value={shiftId} onValueChange={setShiftId}>
            <SelectTrigger className={field}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All Shifts</SelectItem>{shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Person</Label>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className={field}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All Staff</SelectItem>{people.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={load} disabled={isLoading} className="h-10 rounded-full">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
        </Button>
      </div>

      {rows === null ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center text-sm text-muted-foreground bg-card/40">
          Select filters and click <strong>Load</strong> to view the report.
        </div>
      ) : (
        <div className="rounded-3xl border border-border/60 shadow-xs overflow-hidden bg-card p-4 sm:p-6">
          {loadedTab === "attendance" && (
            <DataTable<AttRow>
              data={rows as AttRow[]} keyExtractor={(r) => r.staffId} searchKeys={["staffName", "role", "departmentName"]} searchPlaceholder="Search staff..."
              csvFilename={file} emptyTitle="No data" paginate defaultPageSize={10}
              columns={[
                { key: "staffName", header: "Staff Member" }, { key: "departmentName", header: "Department" }, { key: "shiftName", header: "Shift" },
                { key: "present", header: "Present" }, { key: "late", header: "Late" }, { key: "absent", header: "Absent" },
                { key: "halfDay", header: "Half Day" }, { key: "onLeave", header: "On Leave" },
                { key: "attendancePercent", header: "Attendance %", render: (r) => <Badge variant="outline">{r.attendancePercent}%</Badge> },
              ]}
            />
          )}
          {loadedTab === "leave" && (
            <DataTable<LeaveRow>
              data={rows as LeaveRow[]} keyExtractor={(r) => r.id} searchKeys={["staffName", "leaveType", "status"]} searchPlaceholder="Search leave..."
              csvFilename={file} emptyTitle="No leave requests" paginate defaultPageSize={10}
              columns={[
                { key: "staffName", header: "Staff Member" }, { key: "leaveType", header: "Type" }, { key: "startDate", header: "From" },
                { key: "endDate", header: "To" }, { key: "status", header: "Status" }, { key: "reason", header: "Reason" },
              ]}
            />
          )}
          {loadedTab === "pay" && (
            <DataTable<PayRow>
              data={rows as PayRow[]} keyExtractor={(r) => r.staffId} searchKeys={["staffName", "role", "departmentName"]} searchPlaceholder="Search staff..."
              csvFilename={file} emptyTitle="No data" paginate defaultPageSize={10}
              columns={[
                { key: "staffName", header: "Staff Member" }, { key: "departmentName", header: "Department" }, { key: "shiftName", header: "Shift" },
                { key: "payeeType", header: "Payee Type" }, { key: "pf", header: "PF" }, { key: "esi", header: "ESI" },
                { key: "payableDays", header: "Payable Days" }, { key: "lopDays", header: "LOP Days" },
                { key: "accountNumber", header: "Account No." }, { key: "ifscCode", header: "IFSC" },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
