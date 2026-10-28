"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { downloadMidTimetablePdf } from "@/lib/pdf/downloadMidTimetable";
import type { MidTimetable } from "@/types";
import { MidTimetableGrid } from "./MidTimetableGrid";

// Read-only Mid exam timetables - the published ones the viewer may see (the API
// decides: a student's own branch, a faculty member's branches, every branch for
// the Principal / VP). Filters appear only when there is more than one choice.

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

export function MidTimetableViewer({ emptyText }: { emptyText: string }) {
  const [list, setList] = useState<MidTimetable[] | null>(null);
  const [error, setError] = useState("");
  const [mid, setMid] = useState("");
  const [course, setCourse] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/mid-timetables/published")
      .then(async (r) => { const d = (await r.json()) as { timetables?: MidTimetable[]; error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setList(d.timetables ?? []); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const courseOf = (t: MidTimetable) => `${t.courseName} · ${ordinalYearLabel(t.year)} · Semester ${t.semester}`;
  const mids = useMemo(() => [...new Set((list ?? []).map((t) => t.midNumber))].sort((a, b) => b - a), [list]);
  const courses = useMemo(() => [...new Set((list ?? []).map(courseOf))].sort(), [list]);
  const branches = useMemo(() => [...new Set((list ?? []).map((t) => t.branch))].sort(), [list]);
  const shown = (list ?? []).filter((t) => (!mid || t.midNumber === Number(mid)) && (!course || courseOf(t) === course) && (!branch || t.branch === branch));

  async function pdf(items: MidTimetable[], name: string, key: string) {
    setBusy(key);
    try { await downloadMidTimetablePdf(items, name); }
    catch { toast({ variant: "destructive", title: "Could not make the PDF" }); }
    finally { setBusy(null); }
  }

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>;
  if (!list) return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><CalendarDays className="h-6 w-6" /></span>
        <p className="font-semibold">No Mid timetable yet</p>
        <p className="max-w-md text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(mids.length > 1 || courses.length > 1 || branches.length > 1) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
          {mids.length > 1 && (
            <select aria-label="Mid" className={selectClass} value={mid} onChange={(e) => setMid(e.target.value)}>
              <option value="">All Mids</option>
              {mids.map((m) => <option key={m} value={m}>Mid {m}</option>)}
            </select>
          )}
          {courses.length > 1 && (
            <select aria-label="Course and year" className={selectClass} value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">All courses and years</option>
              {courses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {branches.length > 1 && (
            <select aria-label="Branch" className={selectClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{shown.length} timetable{shown.length === 1 ? "" : "s"}</span>
          {shown.length > 1 && (
            <Button size="sm" variant="outline" loading={busy === "all"} onClick={() => void pdf(shown, "mid-timetables", "all")}><Download className="mr-1.5 h-4 w-4" />PDF of all shown</Button>
          )}
        </div>
      )}

      {shown.map((t) => (
        <section key={t.id} className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label={`Mid ${t.midNumber} ${t.branch}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{courseOf(t)}</p>
              <h2 className="text-lg font-semibold">Mid {t.midNumber} <span className="text-muted-foreground">·</span> {t.branch}</h2>
            </div>
            <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => void pdf([t], `mid${t.midNumber}-${t.branch}-timetable`, t.id)}><Download className="mr-1.5 h-4 w-4" />PDF</Button>
          </div>
          <MidTimetableGrid slots={t.slots} sessions={t.sessions} />
        </section>
      ))}
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No timetable matches these filters.</p>}
    </div>
  );
}
