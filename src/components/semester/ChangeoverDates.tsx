"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, dmy } from "@/lib/utils";
import { semesterLabel, type SemesterRange } from "@/lib/college/semesterDates";

// Semester Changeover > Class-Work End Date: one programme + year, every department's course-year at once. Pick the
// semester whose class work ends, set its last day and the next semester's dates, tick the departments, apply.
// From the day after the end date the timetable, Mark Attendance, teaching load and dashboards follow the next
// semester by themselves (lib/college/semester.ts). Route: api/college/semester-changeover/dates.

interface Programme { catalogId: string; name: string; years: number[] }
interface Row { courseId: string; timingId: string; department: string; semesters: SemesterRange[] }
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "Unable to load. Try again.");
  return d;
}
/** The value most departments already have (so the form starts from the college's usual dates). */
function mostCommon(values: string[]): string {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function ChangeoverDates({ canEdit }: { canEdit: boolean }) {
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [catalogId, setCatalogId] = useState("");
  const [year, setYear] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [semester, setSemester] = useState(0);
  const [f, setF] = useState({ classWorkEnd: "", nextStart: "", nextEnd: "" });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    getJson<{ programmes: Programme[] }>("/api/college/semester-changeover/dates")
      .then((d) => { setProgrammes(d.programmes); if (d.programmes.length === 1) setCatalogId(d.programmes[0].catalogId); })
      .catch((e: Error) => { setProgrammes([]); toast({ variant: "destructive", title: e.message }); });
  }, []);

  useEffect(() => {
    if (!catalogId || !year) return;
    let live = true;
    getJson<{ rows: Row[] }>(`/api/college/semester-changeover/dates?catalogId=${encodeURIComponent(catalogId)}&year=${year}`)
      .then((d) => {
        if (!live) return;
        setRows(d.rows);
        setTicked(new Set(d.rows.map((r) => r.courseId)));
        // The semester running today (else the first of the year), and the dates most departments have now.
        const t = today();
        const all = d.rows.flatMap((r) => r.semesters);
        const running = all.find((s) => s.start <= t && t <= s.end)?.semester ?? Math.min(...all.map((s) => s.semester).filter(Number.isFinite));
        const n = Number.isFinite(running) ? running : 0;
        setSemester(n);
        setF({
          classWorkEnd: mostCommon(all.filter((s) => s.semester === n).map((s) => s.end)),
          nextStart: mostCommon(all.filter((s) => s.semester === n + 1).map((s) => s.start)),
          nextEnd: mostCommon(all.filter((s) => s.semester === n + 1).map((s) => s.end)),
        });
      })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [catalogId, year, tick]);

  const programme = programmes?.find((p) => p.catalogId === catalogId);
  const semesterChoices = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.semesters.map((s) => s.semester)))].sort((a, b) => a - b), [rows]);
  const differs = (r: Row) => {
    const own = r.semesters.find((s) => s.semester === semester);
    const next = r.semesters.find((s) => s.semester === semester + 1);
    return own?.end !== f.classWorkEnd || next?.start !== f.nextStart || next?.end !== f.nextEnd;
  };
  const toApply = (rows ?? []).filter((r) => ticked.has(r.courseId));

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/college/semester-changeover/dates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId, year, semester, ...f, courseIds: toApply.map((r) => r.courseId) }),
      });
      const d = (await res.json().catch(() => ({}))) as { updated?: string[]; error?: string; problems?: string[] };
      if (!res.ok) { toast({ variant: "destructive", title: d.error ?? "Unable to save the dates.", description: d.problems && d.problems.length > 1 ? `${d.problems.length} departments have a problem.` : undefined }); return; }
      toast({ variant: "success", title: `Dates saved for ${d.updated?.length ?? 0} departments.` });
      setConfirm(false); setTick((n) => n + 1);
    } catch { toast({ variant: "destructive", title: "Unable to save the dates. Check the connection and try again." }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4" />Class-Work End Date</CardTitle>
        <CardDescription>Set the last day of class work for a semester once for every department of a year. From the next day the timetable, Mark Attendance, teaching load and dashboards move to the next semester by themselves; the finished semester&apos;s records stay as history.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[14rem] flex-1 space-y-1 sm:max-w-sm"><Label className="text-xs">Programme</Label>
            <select className={selectClass} value={catalogId} onChange={(e) => { setCatalogId(e.target.value); setYear(0); setRows(null); }}>
              <option value="">{programmes === null ? "Loading..." : "Select a programme"}</option>
              {(programmes ?? []).map((p) => <option key={p.catalogId} value={p.catalogId}>{p.name}</option>)}
            </select>
          </div>
          <div className="w-32 space-y-1"><Label className="text-xs">Year</Label>
            <select className={selectClass} value={year || ""} disabled={!programme} onChange={(e) => { setYear(Number(e.target.value)); setRows(null); }}>
              <option value="">Select</option>
              {(programme?.years ?? []).map((y) => <option key={y} value={y}>{ROMAN[y] ?? y} Year</option>)}
            </select>
          </div>
          {rows && semesterChoices.length > 0 && (
            <div className="w-48 space-y-1"><Label className="text-xs">Semester Ending</Label>
              <select className={selectClass} value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
                {semesterChoices.map((s) => <option key={s} value={s}>Semester {s} ({semesterLabel(s)})</option>)}
              </select>
            </div>
          )}
        </div>

        {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No department of this year has semester dates yet. Set them on Semester Timings first.</p>}
        {rows && rows.length > 0 && semester > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label htmlFor="cw-end">Class Work Ends (Semester {semester})</Label><Input id="cw-end" type="date" value={f.classWorkEnd} disabled={!canEdit} onChange={(e) => setF({ ...f, classWorkEnd: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="nx-start">Semester {semester + 1} Starts</Label><Input id="nx-start" type="date" value={f.nextStart} disabled={!canEdit} onChange={(e) => setF({ ...f, nextStart: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="nx-end">Semester {semester + 1} Ends</Label><Input id="nx-end" type="date" value={f.nextEnd} disabled={!canEdit} onChange={(e) => setF({ ...f, nextEnd: e.target.value })} /></div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    {canEdit && <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Tick every department" checked={ticked.size === rows.length} onChange={(e) => setTicked(e.target.checked ? new Set(rows.map((r) => r.courseId)) : new Set())} /></th>}
                    <th className="px-3 py-2 font-medium">Department</th>
                    <th className="px-3 py-2 font-medium">Semester {semester} Now</th>
                    <th className="px-3 py-2 font-medium">Semester {semester + 1} Now</th>
                    <th className="px-3 py-2 font-medium">After Saving</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const own = r.semesters.find((s) => s.semester === semester);
                    const next = r.semesters.find((s) => s.semester === semester + 1);
                    const change = differs(r);
                    return (
                      <tr key={r.courseId}>
                        {canEdit && <td className="px-3 py-2"><input type="checkbox" aria-label={`Apply to ${r.department}`} checked={ticked.has(r.courseId)} onChange={(e) => setTicked((t) => { const n = new Set(t); if (e.target.checked) n.add(r.courseId); else n.delete(r.courseId); return n; })} /></td>}
                        <td className="px-3 py-2 font-medium">{r.department}</td>
                        <td className="px-3 py-2 tabular-nums">{own ? `${dmy(own.start)} to ${dmy(own.end)}` : <span className="text-destructive">Not set up</span>}</td>
                        <td className="px-3 py-2 tabular-nums">{next ? `${dmy(next.start)} to ${dmy(next.end)}` : <span className="text-muted-foreground">Not set</span>}</td>
                        <td className={cn("px-3 py-2 text-xs", change ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{change ? "Changes" : "Same dates"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canEdit ? (
              <Button disabled={!toApply.length || !f.classWorkEnd || !f.nextStart || !f.nextEnd} onClick={() => setConfirm(true)}>Apply to {toApply.length} Department{toApply.length === 1 ? "" : "s"}</Button>
            ) : <p className="text-xs text-muted-foreground">The Principal or the College Office sets these dates.</p>}
          </>
        )}

        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Set the Class-Work End Date?</DialogTitle>
              <DialogDescription>
                {programme?.name} {ROMAN[year]} Year, {toApply.length} department{toApply.length === 1 ? "" : "s"}: Semester {semester} ({semesterLabel(semester)}) class work ends on <b>{dmy(f.classWorkEnd)}</b>; Semester {semester + 1} runs {dmy(f.nextStart)} to {dmy(f.nextEnd)}.
                From {dmy(f.nextStart)} the timetable, Mark Attendance and teaching load follow Semester {semester + 1}. Students detained for Semester {semester} are handled on the Student Review tab.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button loading={busy} onClick={() => void apply()}>Save Dates</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
