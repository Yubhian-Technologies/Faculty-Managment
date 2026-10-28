"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { dayLabel } from "@/lib/midTimetable/rules";
import { Input } from "@/components/ui/input";
import type { Course, CourseYearTiming, ExamMidSchedule, MidExamPlan, MidTimetableStatus } from "@/types";

// Exam Cell > Mid Exams > Mid Timetable: start a Mid's timetable (course, year,
// semester, Mid - its days come from Mid Timings & Dates) and open the ones made.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Plan = MidExamPlan & { timetables: { branch: string; status: MidTimetableStatus }[] };

export default function MidTimetableListPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [midCount, setMidCount] = useState(2);
  const [courseKey, setCourseKey] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [mid, setMid] = useState("1");
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [creating, setCreating] = useState(false);
  const [schedules, setSchedules] = useState<ExamMidSchedule[]>([]);
  // What was typed; null = use the Mid's published dates / time (or the defaults).
  const [typed, setTyped] = useState<{ from: string | null; to: string | null; fromTime: string | null; toTime: string | null }>({ from: null, to: null, fromTime: null, toTime: null });

  const load = useCallback(() => {
    fetch("/api/college/mid-timetables").then((r) => r.json() as Promise<{ plans?: Plan[] }>).then((d) => setPlans(d.plans ?? []))
      .catch(() => { setPlans([]); toast({ variant: "destructive", title: "Failed to load the Mid timetables" }); });
  }, []);
  useEffect(() => {
    load();
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
    fetch("/api/college/exam-mid-schedules").then((r) => r.json() as Promise<{ schedules?: ExamMidSchedule[] }>).then((d) => setSchedules(d.schedules ?? [])).catch(() => undefined);
    fetch("/api/college/exam-mid-settings").then((r) => r.json() as Promise<{ settings?: { midCount?: number } }>).then((d) => setMidCount(d.settings?.midCount || 2)).catch(() => undefined);
  }, [load]);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const group = groups.find((g) => g.key === courseKey) ?? null;
  const years = group ? Array.from({ length: group.durationYears ?? 0 }, (_, i) => i + 1) : [];
  const semesters = useMemo(() => [...new Set(timings.flatMap((t) => (t.semesters ?? []).map((s) => s.semester)))].sort((a, b) => a - b), [timings]);

  // The Mid's published dates (Mid Timings & Dates), when there are any - they fill the dates in.
  const publishedRows = group && semester ? schedules.filter((s) => s.midNumber === Number(mid) && s.semester === Number(semester)
    && ((s.courseId && group.courseIds.includes(s.courseId)) || s.courseName === group.name)) : [];
  const published = publishedRows.length
    ? { from: publishedRows.map((r) => r.fromDate).sort()[0], to: publishedRows.map((r) => r.toDate).sort().reverse()[0], fromTime: publishedRows[0].fromTime, toTime: publishedRows[0].toTime }
    : null;
  const from = typed.from ?? published?.from ?? "";
  const to = typed.to ?? published?.to ?? "";
  const fromTime = typed.fromTime ?? (published?.fromTime || "10:00");
  const toTime = typed.toTime ?? (published?.toTime || "11:30");
  const setFrom = (v: string) => setTyped((t) => ({ ...t, from: v }));
  const setTo = (v: string) => setTyped((t) => ({ ...t, to: v }));
  const setFromTime = (v: string) => setTyped((t) => ({ ...t, fromTime: v }));
  const setToTime = (v: string) => setTyped((t) => ({ ...t, toTime: v }));

  // The year's semesters, from the course-year timings of the programme.
  useEffect(() => {
    if (!group || !year) return;
    let cancelled = false;
    void Promise.all(group.courseIds.map((id) =>
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
        .then((d) => (d.timings ?? []).filter((t) => t.year === Number(year)))
        .catch(() => [] as CourseYearTiming[])
    )).then((lists) => { if (!cancelled) setTimings(lists.flat()); });
    return () => { cancelled = true; };
  }, [group, year]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/college/mid-timetables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey, year: Number(year), semester: Number(semester), midNumber: Number(mid), from, to, fromTime, toTime }),
      });
      const data = (await res.json()) as { error?: string; id?: string; plan?: { id: string } };
      if (res.status === 409 && data.id) { router.push(`/exam-cell/mid-timetable/${encodeURIComponent(data.id)}`); return; }
      if (!res.ok || !data.plan) throw new Error(data.error ?? "Could not create");
      router.push(`/exam-cell/mid-timetable/${encodeURIComponent(data.plan.id)}`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not create" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Mid Timetable" description="One exam timetable per branch for each Mid - built from the Mid's dates and each branch's Theory subjects." />

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Make a Mid timetable</CardTitle>
          <CardDescription>Pick the course, year, semester and Mid, and the exam dates (filled in from Mid Timings &amp; Dates when that Mid&rsquo;s dates are published). Every branch of that year then gets its own timetable; Sundays are left out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="mt-course">Course</Label>
              <select id="mt-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setYear(""); setSemester(""); setTimings([]); }}>
                <option value="">Select course</option>
                {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-year">Year</Label>
              <select id="mt-year" className={selectClass} value={year} disabled={!group} onChange={(e) => { setYear(e.target.value); setSemester(""); setTimings([]); }}>
                <option value="">Select year</option>
                {years.map((y) => <option key={y} value={y}>{ordinalYearLabel(y)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-sem">Semester</Label>
              <select id="mt-sem" className={selectClass} value={semester} disabled={!year || semesters.length === 0} onChange={(e) => { setSemester(e.target.value); setTyped({ from: null, to: null, fromTime: null, toTime: null }); }}>
                <option value="">{year && semesters.length === 0 ? "Not configured" : "Select semester"}</option>
                {semesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-mid">Mid</Label>
              <select id="mt-mid" className={selectClass} value={mid} onChange={(e) => { setMid(e.target.value); setTyped({ from: null, to: null, fromTime: null, toTime: null }); }}>
                {Array.from({ length: Math.max(1, midCount) }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Mid {m}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="mt-from">Exams from</Label>
              <Input id="mt-from" type="date" value={from} min={published?.from} max={published?.to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-to">Exams to</Label>
              <Input id="mt-to" type="date" value={to} min={from || published?.from} max={published?.to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-ft">Exam starts</Label>
              <Input id="mt-ft" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-tt">Exam ends</Label>
              <Input id="mt-tt" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {published ? `From Mid Timings & Dates: ${published.from} to ${published.to}.` : "This Mid has no dates on Mid Timings & Dates - the dates entered here are used."} A second session a day can be added on the next page.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => void create()} loading={creating} disabled={!courseKey || !year || !semester || !from || !to}><Plus className="mr-1.5 h-4 w-4" />Create timetable</Button>
          </div>
        </CardContent>
      </Card>

      {plans === null ? <div className="h-40 animate-pulse rounded-2xl bg-muted" /> : plans.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No Mid timetables yet</p>
          <p className="text-sm text-muted-foreground">Create one above.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((p) => {
            const published = p.timetables.filter((t) => t.status === "PUBLISHED").length;
            const drafts = p.timetables.length - published;
            return (
              <Link key={p.id} href={`/exam-cell/mid-timetable/${encodeURIComponent(p.id)}`}
                className="group rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ordinalYearLabel(p.year)} · Semester {p.semester}</p>
                <p className="mt-0.5 text-lg font-semibold">{p.courseName} <span className="text-primary">· Mid {p.midNumber}</span></p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.days.length ? `${dayLabel(p.days[0])} - ${dayLabel(p.days[p.days.length - 1])}` : "No exam days"} · {p.days.length} day{p.days.length === 1 ? "" : "s"} · {p.sessions.length} session{p.sessions.length === 1 ? "" : "s"} a day
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800">{published} published</span>
                  {drafts > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900">{drafts} draft</span>}
                </div>
                <p className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">Open<ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
