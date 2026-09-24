"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { exportToCSV } from "@/lib/utils";
import { calcPercent, formatPercent } from "@/lib/studentAttendance/percentage";

type RangeMode = "daily" | "monthly" | "period" | "tillNow";
type ViewMode = "subject" | "consolidated";

interface SubjectCol {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}
interface DailyStudent {
  id: string;
  rollNumber: string;
  name: string;
  statusBySubject: Record<string, "PRESENT" | "ABSENT" | null>;
  overall: { held: number; attended: number; percentage: number | null };
}
interface DailyData {
  subjects: SubjectCol[];
  students: DailyStudent[];
}
interface MonthlyStudent {
  id: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, { monthPresent: number; monthTotal: number; monthPercent: number | null }>;
}
interface MonthlyData {
  subjects: SubjectCol[];
  students: MonthlyStudent[];
}
interface RangeStudent {
  studentId: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, { held: number; attended: number; percentage: number | null }>;
  overall: { held: number; attended: number; percentage: number | null };
}
interface RangeData {
  subjects: SubjectCol[];
  students: RangeStudent[];
}

// Subjects to actually show as columns given the current View (subject-wise
// vs consolidated) and optional single-subject filter — same selection logic
// used by both the table render below and CSV export, so what's on screen is
// always what gets exported.
function visibleSubjects(subjects: SubjectCol[], viewMode: ViewMode, subjectId: string): SubjectCol[] {
  if (viewMode === "consolidated") return [];
  if (subjectId) return subjects.filter((s) => s.subjectId === subjectId);
  return subjects;
}

export function SectionReportsView({ sectionId, title }: { sectionId?: string; title: string }) {
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [resolvedSectionId, setResolvedSectionId] = useState(sectionId ?? "");
  const [rangeMode, setRangeMode] = useState<RangeMode>("daily");
  const [viewMode, setViewMode] = useState<ViewMode>("subject");
  const [reportKind, setReportKind] = useState<"all" | "absent" | "shortage">("all");
  const [threshold, setThreshold] = useState(75);
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  // The range mode the currently-loaded `data` actually came from — kept
  // separate from the live `rangeMode` selector so switching the dropdown
  // after loading a report doesn't try to render stale data with the wrong
  // shape (daily/monthly/period-tillNow are three genuinely different
  // response shapes from the API, not just a filter on one shape).
  const [loadedMode, setLoadedMode] = useState<RangeMode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sectionId) return;
    void fetch("/api/college/sections").then((r) => r.json()).then((j) => setSections(j.sections ?? j.data ?? [])).catch(() => {});
  }, [sectionId]);

  async function load() {
    const sid = resolvedSectionId || sectionId;
    if (!sid) { toast({ variant: "destructive", title: "Pick a section" }); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ sectionId: sid });
      if (rangeMode === "daily") {
        if (!date) { toast({ variant: "destructive", title: "Pick date" }); setLoading(false); return; }
        // need year/month/date drill: derive year/month from date
        const y = date.slice(0,4); const m = String(Number(date.slice(5,7)));
        params.set("year", y); params.set("month", m); params.set("date", date);
        params.set("dailyPercent", "true");
      } else if (rangeMode === "monthly") {
        if (!year || !month) { toast({ variant: "destructive", title: "Pick year and month" }); setLoading(false); return; }
        params.set("year", year); params.set("month", month); params.set("summary", "true");
      } else if (rangeMode === "period") {
        if (!from || !to) { toast({ variant: "destructive", title: "Pick from and to" }); setLoading(false); return; }
        params.set("from", from); params.set("to", to);
      } else if (rangeMode === "tillNow") {
        params.set("tillNow", "true");
      }
      if (reportKind === "absent") params.set("absentOnly", "true");
      if (reportKind === "shortage") { params.set("shortage", "true"); params.set("threshold", String(threshold)); }
      if (viewMode === "consolidated") params.set("consolidated", "true");
      if (subjectId) params.set("subjectId", subjectId);
      const res = await fetch(`/api/college/section-attendance-report?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
      setLoadedMode(rangeMode);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" }); }
    finally { setLoading(false); }
  }

  function handleExport() {
    if (!data || !loadedMode) return;
    if (loadedMode === "daily") {
      const d = data as unknown as DailyData;
      const subs = visibleSubjects(d.subjects, viewMode, subjectId);
      const rows = d.students.map((s) => ({
        rollNumber: s.rollNumber,
        name: s.name,
        ...(subs.length
          ? Object.fromEntries(subs.map((sub) => [sub.subjectCode, s.statusBySubject[sub.subjectId] ?? "—"]))
          : {}),
        percent: formatPercent(s.overall.percentage),
      }));
      if (!rows.length) { toast({ variant: "destructive", title: "No data to export" }); return; }
      exportToCSV(rows, `attendance-${reportKind}-daily-${Date.now()}.csv`, [
        { key: "rollNumber", header: "Registration No." },
        { key: "name", header: "Name" },
        ...subs.map((s) => ({ key: s.subjectCode, header: s.subjectName })),
        { key: "percent", header: "%" },
      ]);
      return;
    }
    if (loadedMode === "monthly") {
      const d = data as unknown as MonthlyData;
      const subs = visibleSubjects(d.subjects, viewMode, subjectId);
      const rows = d.students.map((s) => {
        const base: Record<string, string> = { rollNumber: s.rollNumber, name: s.name };
        if (subs.length) {
          for (const sub of subs) base[sub.subjectCode] = formatPercent(s.bySubject[sub.subjectId]?.monthPercent ?? null);
        } else {
          let held = 0, present = 0;
          for (const v of Object.values(s.bySubject)) { held += v.monthTotal; present += v.monthPresent; }
          base.percent = formatPercent(calcPercent(present, held));
        }
        return base;
      });
      if (!rows.length) { toast({ variant: "destructive", title: "No data to export" }); return; }
      exportToCSV(rows, `attendance-${reportKind}-monthly-${Date.now()}.csv`, [
        { key: "rollNumber", header: "Registration No." },
        { key: "name", header: "Name" },
        ...(subs.length
          ? subs.map((s) => ({ key: s.subjectCode, header: s.subjectName }))
          : [{ key: "percent", header: "%" }]),
      ]);
      return;
    }
    // period / tillNow share the same response shape
    const d = data as unknown as RangeData;
    const subs = visibleSubjects(d.subjects, viewMode, subjectId);
    const rows = d.students.map((s) => {
      const base: Record<string, string> = { rollNumber: s.rollNumber, name: s.name };
      if (subs.length) {
        for (const sub of subs) base[sub.subjectCode] = formatPercent(s.bySubject[sub.subjectId]?.percentage ?? null);
      } else {
        base.percent = formatPercent(s.overall.percentage);
      }
      return base;
    });
    if (!rows.length) { toast({ variant: "destructive", title: "No data to export" }); return; }
    exportToCSV(rows, `attendance-${reportKind}-${loadedMode}-${Date.now()}.csv`, [
      { key: "rollNumber", header: "Registration No." },
      { key: "name", header: "Name" },
      ...(subs.length
        ? subs.map((s) => ({ key: s.subjectCode, header: s.subjectName }))
        : [{ key: "percent", header: "%" }]),
    ]);
  }

  function renderTable() {
    if (!data || !loadedMode) return null;
    if (loadedMode === "daily") {
      const d = data as unknown as DailyData;
      const subs = visibleSubjects(d.subjects, viewMode, subjectId);
      return (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2">Reg. No.</th>
              <th className="px-3 py-2">Name</th>
              {subs.map((s) => <th key={s.subjectId} className="border-l px-3 py-2 text-center">{s.subjectName}</th>)}
              <th className="border-l px-3 py-2 text-center">Overall %</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.students.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2">{s.rollNumber}</td>
                <td className="px-3 py-2 font-medium">{s.name}</td>
                {subs.map((sub) => (
                  <td key={sub.subjectId} className="border-l px-3 py-2 text-center">
                    {s.statusBySubject[sub.subjectId] === "PRESENT" ? "P" : s.statusBySubject[sub.subjectId] === "ABSENT" ? "A" : "—"}
                  </td>
                ))}
                <td className="border-l px-3 py-2 text-center font-semibold">{formatPercent(s.overall.percentage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (loadedMode === "monthly") {
      const d = data as unknown as MonthlyData;
      const subs = visibleSubjects(d.subjects, viewMode, subjectId);
      return (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2">Reg. No.</th>
              <th className="px-3 py-2">Name</th>
              {subs.length
                ? subs.map((s) => <th key={s.subjectId} className="border-l px-3 py-2 text-center">{s.subjectName} %</th>)
                : <th className="border-l px-3 py-2 text-center">Consolidated %</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.students.map((s) => {
              let held = 0, present = 0;
              for (const v of Object.values(s.bySubject)) { held += v.monthTotal; present += v.monthPresent; }
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.rollNumber}</td>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  {subs.length
                    ? subs.map((sub) => (
                        <td key={sub.subjectId} className="border-l px-3 py-2 text-center">
                          {formatPercent(s.bySubject[sub.subjectId]?.monthPercent ?? null)}
                        </td>
                      ))
                    : <td className="border-l px-3 py-2 text-center font-semibold">{formatPercent(calcPercent(present, held))}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
    // period / tillNow
    const d = data as unknown as RangeData;
    const subs = visibleSubjects(d.subjects, viewMode, subjectId);
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2">Reg. No.</th>
            <th className="px-3 py-2">Name</th>
            {subs.length
              ? subs.map((s) => <th key={s.subjectId} className="border-l px-3 py-2 text-center">{s.subjectName} %</th>)
              : <th className="border-l px-3 py-2 text-center">Overall %</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {d.students.map((s) => (
            <tr key={s.studentId}>
              <td className="px-3 py-2">{s.rollNumber}</td>
              <td className="px-3 py-2 font-medium">{s.name}</td>
              {subs.length
                ? subs.map((sub) => (
                    <td key={sub.subjectId} className="border-l px-3 py-2 text-center">
                      {formatPercent(s.bySubject[sub.subjectId]?.percentage ?? null)}
                    </td>
                  ))
                : <td className="border-l px-3 py-2 text-center font-semibold">{formatPercent(s.overall.percentage)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!sectionId && (
            <div>
              <Label>Section</Label>
              <Select value={resolvedSectionId} onValueChange={setResolvedSectionId}>
                <SelectTrigger><SelectValue placeholder="Pick section" /></SelectTrigger>
                <SelectContent>{sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label>Range</Label>
              <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="period">Period</SelectItem><SelectItem value="tillNow">Till Now</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>View</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="subject">Subject-wise</SelectItem><SelectItem value="consolidated">Consolidated</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kind</Label>
              <Select value={reportKind} onValueChange={(v) => setReportKind(v as typeof reportKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="absent">Absent</SelectItem><SelectItem value="shortage">Shortage</SelectItem></SelectContent>
              </Select>
            </div>
            {reportKind === "shortage" && (
              <div>
                <Label>Threshold %</Label>
                <Input type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </div>
            )}
          </div>

          {rangeMode === "daily" && (<div><Label>Date (YYYY-MM-DD)</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>)}
          {rangeMode === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" /></div>
              <div><Label>Month</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} placeholder="4" /></div>
            </div>
          )}
          {rangeMode === "period" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SubjectId (optional)</Label><Input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="filter one subject" /></div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Load Report"}</Button>
            <Button variant="outline" onClick={handleExport} disabled={!data}>Export CSV</Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardContent className="overflow-auto pt-4">
            {renderTable()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
