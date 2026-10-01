"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import {
  SubjectRangeSummaryTables, type SubjectColumn, type SubjectRangeStudentRow,
} from "@/components/attendance/SubjectRangeSummaryTables";
import type { StudentAttendanceMark } from "@/types";

type View = "day" | "month" | "period" | "semester" | "tillnow";

interface FacultySection {
  sectionId: string;
  label: string;
  studentCount: number;
}
interface ClassWorkEntry { periodNumber: number; subjectName: string; classNotes: string }
interface DayStudentRow {
  studentId: string;
  rollNumber: string;
  name: string;
  statusByPeriod: Record<number, StudentAttendanceMark | null>;
}
interface DaySubject {
  subjectId: string;
  subjectName: string;
  periods: number[];
  overallPercentage: number;
  percentageByStudent: Record<string, number>;
}
interface DayData {
  classWork: ClassWorkEntry[];
  periods: number[];
  students: DayStudentRow[];
  subjects: DaySubject[];
}
interface RangeData { subjects: SubjectColumn[]; students: SubjectRangeStudentRow[] }

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ddmmyyyy = (d: string) => d.split("-").reverse().join("-");

function Mark({ status }: { status: StudentAttendanceMark | null | undefined }) {
  if (status === "PRESENT") return <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" aria-label="Present" />;
  if (status === "ABSENT") return <XCircle className="mx-auto h-5 w-5 text-red-500" aria-label="Absent" />;
  return <span className="text-muted-foreground">—</span>;
}

// A faculty member's attendance report for the sections they teach, on ONE
// page: pick a section and a view (Day / Month / Period / Semester / Till
// now), fill that view's inputs and press Load. Replaces the section ->
// month -> calendar -> date chain of pages. Data comes from
// /api/college/class-work-records, which is already scoped to the caller's
// own subjects in each section.
export function FacultyAttendanceReportView({ sections }: { sections: FacultySection[] }) {
  const now = new Date();
  const [sectionId, setSectionId] = useState(sections.length === 1 ? sections[0].sectionId : "");
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [semester, setSemester] = useState("");
  const [semesters, setSemesters] = useState<number[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState<{ view: View; label: string } | null>(null);
  const [dayData, setDayData] = useState<DayData | null>(null);
  const [rangeData, setRangeData] = useState<RangeData | null>(null);

  const sectionLabel = sections.find((s) => s.sectionId === sectionId)?.label ?? "";
  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];

  function reset() {
    setLoaded(null);
    setDayData(null);
    setRangeData(null);
  }

  async function changeSection(id: string) {
    setSectionId(id);
    setSemester("");
    setSemesters([]);
    reset();
    try {
      const res = await fetch(`/api/college/class-work-records?sectionId=${encodeURIComponent(id)}&optionsOnly=true`);
      const json = (await res.json()) as { availableSemesters?: number[] };
      setSemesters(json.availableSemesters ?? []);
    } catch {
      /* the Semester view just stays hidden */
    }
  }

  function changeView(next: View) {
    setView(next);
    reset();
  }

  async function load() {
    if (!sectionId) { toast({ variant: "destructive", title: "Pick a section" }); return; }
    const params = new URLSearchParams({ sectionId });
    let label = "";
    if (view === "day") {
      if (!date) { toast({ variant: "destructive", title: "Pick a date" }); return; }
      params.set("year", String(Number(date.slice(0, 4))));
      params.set("month", String(Number(date.slice(5, 7))));
      params.set("date", date);
      label = ddmmyyyy(date);
    } else if (view === "month") {
      params.set("summary", "true");
      params.set("year", year);
      params.set("month", month);
      label = `${MONTH_LABELS[Number(month) - 1]} ${year}`;
    } else if (view === "period") {
      if (!from || !to) { toast({ variant: "destructive", title: "Pick both a From and To date" }); return; }
      if (from > to) { toast({ variant: "destructive", title: "From date must be before the To date" }); return; }
      params.set("summary", "true");
      params.set("from", from);
      params.set("to", to);
      label = `${ddmmyyyy(from)} to ${ddmmyyyy(to)}`;
    } else if (view === "semester") {
      if (!semester) { toast({ variant: "destructive", title: "Pick a semester" }); return; }
      params.set("summary", "true");
      params.set("semester", semester);
      label = `Semester ${semester}`;
    } else {
      params.set("summary", "true");
      params.set("allTime", "true");
      label = "Till now";
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/class-work-records?${params.toString()}`);
      const json = (await res.json()) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load report");
      if (view === "day") {
        setDayData({
          classWork: (json.classWork as ClassWorkEntry[]) ?? [],
          periods: (json.periods as number[]) ?? [],
          students: (json.students as DayStudentRow[]) ?? [],
          subjects: (json.subjects as DaySubject[]) ?? [],
        });
        setRangeData(null);
      } else {
        setRangeData({ subjects: (json.subjects as SubjectColumn[]) ?? [], students: (json.students as SubjectRangeStudentRow[]) ?? [] });
        setDayData(null);
        if (Array.isArray(json.availableSemesters)) setSemesters(json.availableSemesters as number[]);
      }
      setLoaded({ view, label });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load report" });
    } finally {
      setIsLoading(false);
    }
  }

  // One period column belongs to exactly one subject; each subject gets one
  // "Attendance %" column just before its first period that day.
  const dayColumns = useMemo(() => {
    if (!dayData) return [];
    const bySubject = new Map<number, DaySubject>();
    for (const s of dayData.subjects) for (const p of s.periods) bySubject.set(p, s);
    const cols: ({ type: "percent"; subject: DaySubject } | { type: "period"; period: number })[] = [];
    let last: string | null = null;
    for (const p of dayData.periods) {
      const subj = bySubject.get(p);
      if (subj && subj.subjectId !== last) { cols.push({ type: "percent", subject: subj }); last = subj.subjectId; }
      cols.push({ type: "period", period: p });
    }
    return cols;
  }, [dayData]);

  const views: { key: View; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "month", label: "Month" },
    { key: "period", label: "Period" },
    ...(semesters.length > 0 ? [{ key: "semester" as View, label: "Semester" }] : []),
    { key: "tillnow", label: "Till now" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Report"
        description="Pick a section and a view, then press Load to see attendance and class work for your own subjects."
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Section</Label>
              <Select value={sectionId} onValueChange={(v) => void changeSection(v)}>
                <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.sectionId} value={s.sectionId}>{s.label} · {s.studentCount} students</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>View</Label>
              <Select value={view} onValueChange={(v) => changeView(v as View)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {views.map((v) => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {view === "day" && (
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); reset(); }} />
              </div>
            )}
            {view === "month" && (
              <>
                <div className="space-y-1.5">
                  <Label>Month</Label>
                  <Select value={month} onValueChange={(v) => { setMonth(v); reset(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_LABELS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Year</Label>
                  <Select value={year} onValueChange={(v) => { setYear(v); reset(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {view === "period" && (
              <>
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
                </div>
                <div className="space-y-1.5">
                  <Label>To</Label>
                  <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
                </div>
              </>
            )}
            {view === "semester" && (
              <div className="space-y-1.5">
                <Label>Semester</Label>
                <Select value={semester} onValueChange={(v) => { setSemester(v); reset(); }}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {semesters.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Button onClick={() => void load()} disabled={!sectionId || isLoading}>
            <Search className="mr-2 h-4 w-4" />{isLoading ? "Loading…" : "Load Report"}
          </Button>
        </CardContent>
      </Card>

      {!loaded ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Pick a section and a view above, then press Load Report.
        </div>
      ) : loaded.view === "day" && dayData ? (
        dayData.periods.length === 0 || dayData.students.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance record for {sectionLabel} on {loaded.label}.
          </CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="space-y-3 py-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</p>
                  <p className="text-sm font-semibold">{loaded.label}</p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Record of the Class Work</p>
                  {dayData.classWork.map((c) => (
                    <p key={c.periodNumber} className="text-sm">
                      {dayData.periods.length > 1 && <span className="font-semibold">Period {c.periodNumber} ({c.subjectName}): </span>}
                      {c.classNotes || "—"}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
            {dayData.subjects.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {dayData.subjects.map((subj) => (
                  <div key={subj.subjectId} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
                    Overall Attendance{dayData.subjects.length > 1 ? ` — ${subj.subjectName}` : ""}: <strong>{subj.overallPercentage}%</strong>
                  </div>
                ))}
              </div>
            )}
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Registration Number</th>
                      <th className="px-4 py-3">Name</th>
                      {dayColumns.map((c) => c.type === "percent"
                        ? <th key={`pct-${c.subject.subjectId}`} className="px-4 py-3 text-center">Attendance %{dayData.subjects.length > 1 ? ` (${c.subject.subjectName})` : ""}</th>
                        : <th key={`p-${c.period}`} className="px-4 py-3 text-center">Period {c.period}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dayData.students.map((s, i) => (
                      <tr key={`${s.rollNumber}-${i}`}>
                        <td className="px-4 py-2.5">{s.rollNumber}</td>
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        {dayColumns.map((c) => c.type === "percent"
                          ? <td key={`pct-${c.subject.subjectId}`} className="px-4 py-2.5 text-center font-semibold">{c.subject.percentageByStudent[s.studentId] ?? 0}%</td>
                          : <td key={`p-${c.period}`} className="px-4 py-2.5 text-center"><Mark status={s.statusByPeriod[c.period]} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )
      ) : rangeData ? (
        rangeData.subjects.length === 0 || rangeData.students.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance record for {sectionLabel} · {loaded.label}.
          </CardContent></Card>
        ) : (
          <SubjectRangeSummaryTables subjects={rangeData.subjects} students={rangeData.students} />
        )
      ) : null}
    </div>
  );
}
