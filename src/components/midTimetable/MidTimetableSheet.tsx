"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

// A Mid timetable as the college prints it: branches down the side (each with
// its usual session's time), exam days across the top, each cell the subject(s)
// written that day - electives under their heading, an exam at another time
// (or a second exam that day) with its own time.

export interface SheetRow { key: string; branch: string; slots: MidExamSlot[]; usualSessionId?: string; aside?: ReactNode }

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? "";

export function SheetCell({ slots }: { slots: MidExamSlot[] }) {
  const group = slots.find((s) => s.group)?.group;
  const movedFrom = slots.find((s) => s.movedFrom)?.movedFrom;
  return (
    <div className="space-y-1 text-center">
      {movedFrom && <p className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Rescheduled · was {dmy(movedFrom)}</p>}
      {group && <p className="text-[11px] font-semibold underline underline-offset-2">{group}</p>}
      {slots.map((s, i) => (
        <p key={s.subjectId} className="text-xs leading-snug">
          <span className="font-medium">{s.subjectName}</span> <span className="text-muted-foreground">({s.subjectCode})</span>{i < slots.length - 1 && <span className="text-muted-foreground"> /</span>}
        </p>
      ))}
    </div>
  );
}

/** A branch's exams on one day: each session's subjects, with its time when it isn't the branch's usual one (or there are two that day). */
export function DayCell({ slots, sessions, usualSessionId }: { slots: MidExamSlot[]; sessions: MidExamSession[]; usualSessionId?: string }) {
  const bySession = [...new Set(slots.map((s) => s.sessionId))]
    .map((id) => ({ ses: sessions.find((x) => x.id === id), list: slots.filter((s) => s.sessionId === id) }))
    .sort((a, b) => (a.ses?.from ?? "").localeCompare(b.ses?.from ?? ""));
  const showTimes = bySession.length > 1 || bySession.some((g) => g.ses && g.ses.id !== usualSessionId);
  return (
    <div className="space-y-2">
      {bySession.map(({ ses, list }, i) => (
        <div key={ses?.id ?? i} className={cn(i > 0 && "border-t border-dashed pt-2")}>
          {showTimes && ses && <p className="mb-1 text-center text-[10px] font-semibold text-primary">{timeLabel(ses.from)} - {timeLabel(ses.to)}</p>}
          <SheetCell slots={list} />
        </div>
      ))}
    </div>
  );
}

export function MidTimetableSheet({ rows, days, sessions, onCell, cellTitle }: {
  rows: SheetRow[];
  days: string[];
  sessions: MidExamSession[];
  /** Makes cells clickable (the Exam Cell builder) - the session is picked in the cell. */
  onCell?: (rowKey: string, date: string) => void;
  cellTitle?: string;
}) {
  if (days.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No exam days.</p>;
  const usualOf = (r: SheetRow) => sessions.find((x) => x.id === r.usualSessionId);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 min-w-44 border-b border-r bg-muted p-3 text-left text-xs font-semibold">Branch</th>
            {days.map((d) => (
              <th key={d} className="min-w-36 border-b border-r p-2 text-center text-xs font-semibold last:border-r-0">
                {dmy(d)}<span className="block font-normal text-muted-foreground">({weekday(d)})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const usual = usualOf(r);
            return (
              <tr key={r.key} className="align-top">
                <th scope="row" className="sticky left-0 z-10 border-b border-r bg-card p-3 text-left font-medium">
                  <span className="block leading-snug">{r.branch}</span>
                  {usual && <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{usual.label} · {timeLabel(usual.from)} - {timeLabel(usual.to)}</span>}
                  {r.aside}
                </th>
                {days.map((date) => {
                  const here = r.slots.filter((s) => s.date === date);
                  const label = `${r.branch}, ${dayLabel(date)}`;
                  return (
                    <td key={date} className="border-b border-r p-1.5 last:border-r-0">
                      {onCell ? (
                        <button type="button" onClick={() => onCell(r.key, date)} title={cellTitle} aria-label={here.length ? `${label}: ${here.map((s) => s.subjectName).join(" / ")} - change` : `${label}: add a subject`}
                          className={cn("flex min-h-16 w-full items-center justify-center rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            here.length ? "bg-primary/5 ring-1 ring-primary/15 hover:bg-primary/10" : "border border-dashed text-muted-foreground hover:border-primary/50 hover:text-primary")}>
                          {here.length ? <DayCell slots={here} sessions={sessions} usualSessionId={r.usualSessionId} /> : <Plus className="h-4 w-4" />}
                        </button>
                      ) : here.length ? <div className="p-1.5"><DayCell slots={here} sessions={sessions} usualSessionId={r.usualSessionId} /></div> : <p className="p-2 text-center text-xs text-muted-foreground">-</p>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One branch's own timetable as a list: each exam's day, time and subject(s). */
export function BranchTimetableList({ slots, sessions }: { slots: MidExamSlot[]; sessions: MidExamSession[] }) {
  const exams = [...new Set(slots.map((x) => `${x.date}|${x.sessionId}`))]
    .map((k) => { const [d, sid] = k.split("|"); return { d, ses: sessions.find((x) => x.id === sid), list: slots.filter((x) => x.date === d && x.sessionId === sid) }; })
    .sort((a, b) => a.d.localeCompare(b.d) || (a.ses?.from ?? "").localeCompare(b.ses?.from ?? ""));
  if (exams.length === 0) return <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No exams placed yet.</p>;
  return (
    <ol className="divide-y rounded-xl border">
      {exams.map(({ d, ses, list }) => (
        <li key={`${d}|${ses?.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 sm:p-4">
          <div className="w-44 shrink-0">
            <p className="font-semibold">{dayLabel(d)}</p>
            {ses && <p className="text-xs text-muted-foreground">{sessions.length > 1 ? `${ses.label} · ` : ""}{timeLabel(ses.from)} - {timeLabel(ses.to)}</p>}
          </div>
          <div className="min-w-0 flex-1 text-left [&_div]:text-left"><SheetCell slots={list} /></div>
        </li>
      ))}
    </ol>
  );
}
