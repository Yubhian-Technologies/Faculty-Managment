"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarDays, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { dayLabel, timeLabel, usualSessionOf } from "@/lib/midTimetable/rules";
import { downloadMidTimetablePdf } from "@/lib/pdf/downloadMidTimetable";
import type { MidExamSession, MidTimetable } from "@/types";
import { BranchTimetableList, MidTimetableSheet } from "./MidTimetableSheet";

// Read-only Mid exam timetables: the published ones the viewer may see (the API
// decides - a student's own branch, a faculty member's branches, every branch
// for the Principal / VP), one sheet per Mid like the printed one. A single
// branch reads better as a list of days, so that is how it is shown.

interface Sheet { planId: string; courseName: string; year: number; semester: number; midNumber: number; days: string[]; sessions: MidExamSession[]; rows: MidTimetable[] }

function toSheets(list: MidTimetable[]): Sheet[] {
  const by = new Map<string, MidTimetable[]>();
  for (const t of list) by.set(t.planId, [...(by.get(t.planId) ?? []), t]);
  return [...by.entries()].map(([planId, rows]) => {
    const sessions = new Map<string, MidExamSession>();
    for (const r of rows) for (const s of r.sessions) if (!sessions.has(s.id)) sessions.set(s.id, s);
    const used = new Set(rows.flatMap((r) => r.slots.map((s) => s.sessionId)));
    return {
      planId, courseName: rows[0].courseName, year: rows[0].year, semester: rows[0].semester, midNumber: rows[0].midNumber,
      days: [...new Set(rows.flatMap((r) => r.slots.map((s) => s.date)))].sort(),
      sessions: [...sessions.values()].filter((s) => used.has(s.id)).sort((a, b) => a.from.localeCompare(b.from)),
      rows: [...rows].sort((a, b) => a.branch.localeCompare(b.branch)),
    };
  }).sort((a, b) => (b.days[0] ?? "").localeCompare(a.days[0] ?? "") || a.courseName.localeCompare(b.courseName) || a.year - b.year);
}

export function MidTimetableViewer({ emptyText }: { emptyText: string }) {
  const [list, setList] = useState<MidTimetable[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/mid-timetables/published")
      .then(async (r) => { const d = (await r.json()) as { timetables?: MidTimetable[]; error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setList(d.timetables ?? []); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  const sheets = useMemo(() => toSheets(list ?? []), [list]);

  async function pdf(s: Sheet, mode: "sheet" | "branches" | "sessions" = s.rows.length === 1 ? "branches" : "sheet") {
    setBusy(`${s.planId}|${mode}`);
    try { await downloadMidTimetablePdf({ ...s, rows: s.rows.map((r) => ({ branch: r.branch, slots: r.slots, usualSessionId: r.usualSessionId ?? usualSessionOf(r.sessions, undefined, r.slots) })) }, `mid${s.midNumber}-${s.courseName}-year${s.year}-${s.rows.length === 1 ? s.rows[0].branch : mode === "sessions" ? "session-wise" : "timetable"}`, mode); }
    catch { toast({ variant: "destructive", title: "Could not make the PDF" }); }
    finally { setBusy(null); }
  }

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>;
  if (!list) return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  if (sheets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><CalendarDays className="h-6 w-6" /></span>
        <p className="font-semibold">No Mid timetable yet</p>
        <p className="max-w-md text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sheets.map((s) => (
        <section key={s.planId} className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label={`Mid ${s.midNumber} timetable`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.courseName} · {ordinalYearLabel(s.year)} · Semester {s.semester}</p>
              <h2 className="text-lg font-semibold">Mid {s.midNumber} timetable{s.rows.length === 1 ? ` · ${s.rows[0].branch}` : ""}</h2>
              {s.sessions.length === 1 && <p className="text-sm text-muted-foreground">Time: {timeLabel(s.sessions[0].from)} - {timeLabel(s.sessions[0].to)}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {s.rows.length > 1 && s.sessions.length > 1 && <Button size="sm" variant="outline" loading={busy === `${s.planId}|sessions`} onClick={() => void pdf(s, "sessions")}><Download className="mr-1.5 h-4 w-4" />Session-wise PDF</Button>}
              <Button size="sm" variant="outline" loading={busy === `${s.planId}|${s.rows.length === 1 ? "branches" : "sheet"}`} onClick={() => void pdf(s)}><Download className="mr-1.5 h-4 w-4" />{s.rows.length > 1 ? "Combined PDF" : "PDF"}</Button>
            </div>
          </div>
          {(() => {
            const last = s.rows.flatMap((r) => r.changes ?? []).sort((a, b) => b.at.localeCompare(a.at))[0];
            return last ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                <span><span className="font-semibold">{last.toDate > last.fromDate ? "Postponed" : "Preponed"}:</span> {dayLabel(last.fromDate)} exam moved to {dayLabel(last.toDate)}{last.reason ? ` - ${last.reason}` : ""}.</span>
              </p>
            ) : null;
          })()}
          {s.rows.length === 1 ? (
            <BranchTimetableList slots={s.rows[0].slots} sessions={s.sessions} />
          ) : (
            <MidTimetableSheet rows={s.rows.map((r) => ({ key: r.id, branch: r.branch, slots: r.slots, usualSessionId: r.usualSessionId ?? usualSessionOf(r.sessions, undefined, r.slots) }))} days={s.days} sessions={s.sessions} />
          )}
        </section>
      ))}
    </div>
  );
}
