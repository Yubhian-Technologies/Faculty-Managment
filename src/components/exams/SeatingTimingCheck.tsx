"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";

// The plan against the Mid timetable's exam timings (GET .../exam-seating/[id]/check):
// room clashes with other plans (Publish is refused while there are any), exams of
// its branches at another time (they sit in the same seats then), and branches whose
// session changed after the plan was built.

interface Use { room: string; group: string; date: string; from: string; to: string; subjects: string[] }
interface Check { examTime: string; clashes: { room: string; date: string; mine: Use; theirs: Use; otherPlan: string }[]; offSession: Use[]; moved: { group: string; now: string }[] }

const span = (from: string, to: string) => `${timeLabel(from)} - ${timeLabel(to)}`;

export function SeatingTimingCheck({ planId, reloadKey }: { planId: string; reloadKey?: unknown }) {
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/college/exam-seating/${encodeURIComponent(planId)}/check`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setCheck(d as Check | null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [planId, reloadKey]);
  if (!check) return null;
  const ok = check.clashes.length === 0 && check.moved.length === 0;
  return (
    <Card className={ok ? "border-emerald-300/70" : "border-destructive/50"}>
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
          Timing check{check.examTime ? ` · ${span(...(check.examTime.split("-") as [string, string]))}` : ""}
        </p>
        {ok && <p className="text-muted-foreground">No room is used by another seating plan at the same time.</p>}
        {check.clashes.length > 0 && (
          <div>
            <p className="font-medium text-destructive">Rooms also in use by another plan at the same time - change the rooms or the timetable before publishing:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {check.clashes.map((c, i) => (
                <li key={i}>Room <b>{c.room}</b>, {dayLabel(c.date)}: {c.mine.group} ({c.mine.subjects.join(" / ")}, {span(c.mine.from, c.mine.to)}) and {c.theirs.group} ({c.theirs.subjects.join(" / ")}, {span(c.theirs.from, c.theirs.to)}) of &ldquo;{c.otherPlan}&rdquo;</li>
              ))}
            </ul>
          </div>
        )}
        {check.moved.length > 0 && (
          <div>
            <p className="font-medium text-destructive">These branches now write at another time in the timetable - build this plan again:</p>
            <ul className="mt-1 list-disc pl-5">{check.moved.map((m) => <li key={m.group}>{m.group}: now {span(...(m.now.split("-") as [string, string]))}</li>)}</ul>
          </div>
        )}
        {check.offSession.length > 0 && (
          <div className="rounded-lg bg-muted/40 p-2.5">
            <p className="flex items-center gap-1.5 font-medium"><Clock className="h-4 w-4" />Exams at another time - these students sit in the same seats then:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{check.offSession.map((u, i) => <li key={i}>{u.group}: {dayLabel(u.date)}, {span(u.from, u.to)} - {u.subjects.join(" / ")}</li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
