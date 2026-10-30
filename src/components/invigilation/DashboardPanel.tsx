"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/invigilation/eligibility";
import { ACTIVE_DUTY_STATUSES, DUTY_CATEGORIES, DUTY_CATEGORY_LABELS } from "@/types/invigilation";
import { designationLabel, type CandidateRow, type Overview } from "./model";

// Exam Cell > Invigilation > Dashboard: places needed vs filled, workload
// spread, designation / category counts, repeated rooms and every override.
// Availability per session is counted on request (it reads every timetable).

const sessionLabel = (s: string) => { const [d, t] = s.split("|"); const [f, to] = (t ?? "").split("-"); return `${dayLabel(d)} · ${timeLabel(f)} - ${timeLabel(to)}`; };

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p></CardContent></Card>
  );
}

export function DashboardPanel({ overview, onOpenSlot }: { overview: Overview; onOpenSlot: (slotKey: string) => void }) {
  const { slots, duties, faculty, sessions, schedule, seatingPlans } = overview;
  const live = duties.filter((d) => ACTIVE_DUTY_STATUSES.includes(d.status));
  const required = slots.reduce((n, s) => n + s.required, 0);
  const filled = slots.reduce((n, s) => n + Math.min(s.filled, s.required), 0);
  const exams = new Set(slots.flatMap((s) => s.subjects.map((x) => `${s.session}|${x.id}`))).size;
  const overrides = duties.flatMap((d) => (d.overrides ?? []).map((o) => ({ d, o })));
  const [avail, setAvail] = useState<Record<string, Record<string, number>> | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);

  const spread = useMemo(() => {
    const counts = faculty.filter((f) => !f.inactive).map((f) => live.filter((d) => d.facultyId === f.id && schedule.rules.countCategories.includes(d.category)).length);
    const max = Math.max(0, ...counts);
    return Array.from({ length: max + 1 }, (_, n) => ({ n, people: counts.filter((c) => c === n).length }));
  }, [faculty, live, schedule.rules.countCategories]);
  const peak = Math.max(1, ...spread.map((x) => x.people));

  const byDesignation = useMemo(() => {
    const m = new Map<string, { people: number; duties: number }>();
    for (const f of faculty) {
      const k = designationLabel(f.designation) || "-";
      const g = m.get(k) ?? { people: 0, duties: 0 };
      const n = live.filter((d) => d.facultyId === f.id).length;
      if (n) g.people++;
      g.duties += n;
      m.set(k, g);
    }
    return [...m].filter(([, g]) => g.duties).sort((a, b) => b[1].duties - a[1].duties);
  }, [faculty, live]);

  const repeats = useMemo(() => {
    const m = new Map<string, typeof live>();
    for (const d of live) if (d.roomId) m.set(`${d.facultyId}|${d.roomId}`, [...(m.get(`${d.facultyId}|${d.roomId}`) ?? []), d]);
    return [...m.values()].filter((l) => l.length > 1);
  }, [live]);

  async function countAvailability() {
    setLoadingAvail(true);
    const out: Record<string, Record<string, number>> = {};
    for (const s of sessions) {
      const res = await fetch(`/api/college/invigilation/schedules/${schedule.id}/candidates?session=${encodeURIComponent(s)}`, { cache: "no-store" }).catch(() => null);
      const d = res?.ok ? ((await res.json()) as { candidates?: CandidateRow[] }) : { candidates: [] };
      out[s] = {};
      for (const c of d.candidates ?? []) out[s][c.availability] = (out[s][c.availability] ?? 0) + 1;
      setAvail({ ...out });
    }
    setLoadingAvail(false);
  }

  return (
    <div className="space-y-4">
      {seatingPlans.length === 0 && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">No Exam Seating plan is built from these Mid timetables yet - room invigilators appear once one is.</p>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Exams scheduled" value={exams} />
        <Stat label="Sessions" value={sessions.length} />
        <Stat label="Places needed" value={required} />
        <Stat label="Filled" value={filled} />
        <Stat label="Unfilled" value={required - filled} tone={required - filled ? "warn" : undefined} />
        <Stat label="Overrides" value={overrides.length} tone={overrides.length ? "warn" : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Sessions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Session</th>{DUTY_CATEGORIES.filter((c) => schedule.rules.categories[c]).map((c) => <th key={c} className="p-2">{DUTY_CATEGORY_LABELS[c]}</th>)}<th className="p-2">Published</th><th className="p-2">Available faculty</th></tr></thead>
            <tbody>
              {sessions.map((s) => {
                const here = slots.filter((x) => x.session === s);
                return (
                  <tr key={s} className="border-t">
                    <td className="p-2">{sessionLabel(s)}</td>
                    {DUTY_CATEGORIES.filter((c) => schedule.rules.categories[c]).map((c) => {
                      const list = here.filter((x) => x.category === c);
                      const need = list.reduce((n, x) => n + x.required, 0), have = list.reduce((n, x) => n + Math.min(x.filled, x.required), 0);
                      const first = list.find((x) => x.filled < x.required);
                      return <td key={c} className="p-2"><button type="button" disabled={!first} onClick={() => first && onOpenSlot(first.key)} className="disabled:cursor-default"><Badge variant={have >= need ? "approved" : have ? "pending" : "outline"}>{have}/{need}</Badge></button></td>;
                    })}
                    <td className="p-2">{schedule.publishedSessions.includes(s) ? <Badge variant="approved">Yes</Badge> : <Badge variant="outline">No</Badge>}</td>
                    <td className="p-2 text-xs">{avail?.[s] ? Object.entries(avail[s]).sort().map(([k, v]) => `${AVAILABILITY_LABELS[k as Availability]} ${v}`).join(" · ") : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t p-2"><Button size="sm" variant="outline" loading={loadingAvail} onClick={() => void countAvailability()}>Count available faculty per session</Button></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Workload spread</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {spread.map((x) => (
              <div key={x.n} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{x.n} dut{x.n === 1 ? "y" : "ies"}</span>
                <div className="h-4 flex-1 rounded bg-muted"><div className="h-4 rounded bg-blue-600" style={{ width: `${(x.people / peak) * 100}%` }} /></div>
                <span className="w-16 text-right tabular-nums">{x.people} people</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By designation and category</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">{DUTY_CATEGORIES.map((c) => <Badge key={c} variant="outline">{DUTY_CATEGORY_LABELS[c]}: {live.filter((d) => d.category === c).length}</Badge>)}</div>
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Designation</th><th className="py-1 text-right">People on duty</th><th className="py-1 text-right">Duties</th></tr></thead>
              <tbody>{byDesignation.map(([k, g]) => <tr key={k} className="border-t"><td className="py-1">{k}</td><td className="py-1 text-right">{g.people}</td><td className="py-1 text-right">{g.duties}</td></tr>)}</tbody></table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Same room more than once ({repeats.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {repeats.length === 0 ? <p className="text-muted-foreground">None.</p> : repeats.map((l) => <p key={l[0].id}><b>{l[0].facultyName}</b> · {l[0].room} · {l.map((d) => d.date.slice(5)).join(", ")}</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Overrides approved ({overrides.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {overrides.length === 0 ? <p className="text-muted-foreground">None.</p> : overrides.map(({ d, o }, i) => (
              <div key={i} className="rounded border p-2"><p><b>{d.facultyName}</b> · {d.room ?? DUTY_CATEGORY_LABELS[d.category]} · {d.date}</p><p className="text-xs text-amber-700 dark:text-amber-400">{o.message}</p><p className="text-xs">&ldquo;{o.reason}&rdquo; - {o.byName}</p></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
