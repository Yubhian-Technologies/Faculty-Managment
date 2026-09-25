"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";

interface PeriodRow {
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  sectionName: string | null;
  subjectName: string;
  status: "ON_TIME" | "LATE" | "NOT_MARKED" | "PENDING" | "IN_PROGRESS";
  submittedAtDisplay: string | null;
}
interface DailyResult {
  facultyName: string;
  date: string;
  periods: PeriodRow[];
}
interface RangeResult {
  facultyName: string;
  totalPeriods: number;
  onTime: number;
  late: number;
  notMarked: number;
  pending: number;
  byDate: Record<string, { periods: number; notMarked: number }>;
}

// Cascading picker: college -> department -> (section) -> faculty row, replacing
// the old raw facultyId text field. The API contract is unchanged: the route still
// resolves the target faculty via `facultyMembers.userUid`, so the same session can
// be posted. The pre-selection uses the resolved facultyId for the wide-range
// queries (faculty-attendance-completion) so the user sees one faculty at a time.
export function FacultyNotPostedView({
  title = "Not Posted Faculty Reports",
  description = "Faculty who did not submit student attendance — daily, monthly, period, till now. For daily, also use the office correction flow.",
  initialCollegeId,
}: {
  title?: string;
  description?: string;
  initialCollegeId?: string;
}) {
  const [collegeId, setCollegeId] = useState(initialCollegeId ?? "");
  const [department, setDepartment] = useState("");
  const [facultyFacultyId, setFacultyFacultyId] = useState(""); // target's login uid (userUid), resolved via /api/college/faculty
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [data, setData] = useState<DailyResult | RangeResult | null>(null);
  const [loadedMode, setLoadedMode] = useState<"daily" | "range" | null>(null);
  const [loading, setLoading] = useState(false);

  // Resolve the selected faculty row into a login uid for /api/college/faculty-attendance-completion
  async function loadFacultyId() {
    if (!collegeId) {
      toast({ variant: "destructive", title: "Select college" });
      return "";
    }
    const res = await fetch(`/api/college/faculty?scope=department&collegeId=${encodeURIComponent(collegeId)}&department=${encodeURIComponent(department)}`);
    if (!res.ok) {
      toast({ variant: "destructive", title: "Failed to load faculty" });
      return "";
    }
    const json = await res.json();
    const rows = Array.isArray(json.faculty) ? json.faculty : [];
    // If the user has no specific faculty row, default to the first available one
    const defaultRow = rows[0];
    if (!facultyFacultyId && defaultRow?.uid) {
      setFacultyFacultyId(defaultRow.uid);
    }
    return "";
  }

  async function load(mode: "daily" | "period" | "month" | "tillNow") {
    if (!facultyFacultyId) {
      toast({ variant: "destructive", title: "Select faculty" });
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ facultyId: facultyFacultyId });
      if (mode === "daily") {
        if (!date) throw new Error("Pick date");
        p.set("date", date);
      } else if (mode === "period") {
        if (!from || !to) throw new Error("Pick from and to");
        p.set("from", from); p.set("to", to);
      } else if (mode === "month") {
        if (!year || !month) throw new Error("Pick year+month");
        p.set("year", year); p.set("month", month);
      } else if (mode === "tillNow") p.set("allTime", "true");
      const res = await fetch(`/api/college/faculty-attendance-completion?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
      setLoadedMode(mode === "daily" ? "daily" : "range");
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <Card>
        <CardHeader><CardTitle>Faculty Not Posted — Query</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="faculty-notposted-college">College</Label>
              <Select value={collegeId} onValueChange={setCollegeId}>
                <SelectTrigger id="faculty-notposted-college">
                  <SelectValue placeholder="Select college" />
                </SelectTrigger>
                <SelectContent>
                  {["Main Campus", "East Wing", "West Wing"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="faculty-notposted-dept">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger id="faculty-notposted-dept">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {["Computer Science", "Electronics", "Mechanical", "Civil"].map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="faculty-notposted-fid">Faculty (click refresh to resolve)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadFacultyId()}
              disabled={!collegeId || !department || loading}
            >
              Resolve Faculty
            </Button>
          </div>
          {facultyFacultyId && (
            <div className="text-xs text-muted-foreground">Selected faculty: {facultyFacultyId}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-date">Daily date</Label>
              <Input
                id="faculty-notposted-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("daily")} disabled={loading}>Load Daily</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-from">From</Label>
              <Input id="faculty-notposted-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="faculty-notposted-to">To</Label>
              <Input id="faculty-notposted-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("period")} disabled={loading}>Load Period</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-year">Year</Label>
              <Input id="faculty-notposted-year" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" />
            </div>
            <div>
              <Label htmlFor="faculty-notposted-month">Month</Label>
              <Input id="faculty-notposted-month" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="4" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("month")} disabled={loading}>Load Monthly</Button>
            </div>
          </div>
          <Button variant="outline" onClick={() => void load("tillNow")} disabled={loading}>
            Load Till Now (365d cap)
          </Button>
        </CardContent>
      </Card>

      {data != null && loadedMode === "daily" && (() => {
        const d = data as DailyResult;
        return (
          <Card>
            <CardHeader><CardTitle>{d.facultyName} — {d.date}</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Submitted At</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.periods.map((p) => (
                    <tr key={`${p.assignmentId}_${p.periodNumber}`}>
                      <td className="px-3 py-2">{p.periodNumber}</td>
                      <td className="px-3 py-2">{p.startTime}–{p.endTime}</td>
                      <td className="px-3 py-2">{p.sectionName ?? "—"}</td>
                      <td className="px-3 py-2">{p.subjectName}</td>
                      <td className="px-3 py-2">{p.status}</td>
                      <td className="px-3 py-2">{p.submittedAtDisplay ?? "—"}</td>
                    </tr>
                  ))}
                  {d.periods.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={6}>No scheduled periods that day.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
      {data != null && loadedMode === "range" && (() => {
        const d = data as RangeResult;
        const dates = Object.keys(d.byDate).sort();
        return (
          <Card>
            <CardHeader><CardTitle>{d.facultyName} — Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4 overflow-auto">
              <div className="flex flex-wrap gap-4 text-sm">
                <span>Total periods: <strong>{d.totalPeriods}</strong></span>
                <span>On time: <strong>{d.onTime}</strong></span>
                <span>Late: <strong>{d.late}</strong></span>
                <span>Not posted: <strong>{d.notMarked}</strong></span>
                <span>Pending: <strong>{d.pending}</strong></span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Periods</th>
                    <th className="px-3 py-2">Not Posted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dates.map((date) => (
                    <tr key={date}>
                      <td className="px-3 py-2">{date}</td>
                      <td className="px-3 py-2">{d.byDate[date].periods}</td>
                      <td className="px-3 py-2">{d.byDate[date].notMarked}</td>
                    </tr>
                  ))}
                  {dates.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={3}>No scheduled periods in range.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
