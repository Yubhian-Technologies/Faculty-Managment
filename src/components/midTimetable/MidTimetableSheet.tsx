"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

// A Mid timetable as the college prints it: branches down the side, exam days
// across the top (a column per session when a day has more than one), each
// cell the subject(s) written then - electives under their heading.

export interface SheetRow { key: string; branch: string; slots: MidExamSlot[]; aside?: ReactNode }

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

export function MidTimetableSheet({ rows, days, sessions, onCell, cellTitle }: {
  rows: SheetRow[];
  days: string[];
  sessions: MidExamSession[];
  /** Makes cells clickable (the Exam Cell builder). */
  onCell?: (rowKey: string, date: string, sessionId: string) => void;
  cellTitle?: string;
}) {
  const cols = days.flatMap((d) => sessions.map((s) => ({ date: d, session: s })));
  if (days.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No exam days.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th rowSpan={sessions.length > 1 ? 2 : 1} className="sticky left-0 z-10 min-w-40 border-b border-r bg-muted p-3 text-left text-xs font-semibold">Branch</th>
            {days.map((d) => (
              <th key={d} colSpan={sessions.length} className="min-w-36 border-b border-r p-2 text-center text-xs font-semibold last:border-r-0">
                {dmy(d)}<span className="block font-normal text-muted-foreground">({weekday(d)})</span>
              </th>
            ))}
          </tr>
          {sessions.length > 1 && (
            <tr className="bg-muted/30">
              {cols.map(({ date, session }) => (
                <th key={`${date}|${session.id}`} className="border-b border-r p-1.5 text-center text-[11px] font-medium text-muted-foreground last:border-r-0">
                  {session.label}<span className="block font-normal">{timeLabel(session.from)}</span>
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              <th scope="row" className="sticky left-0 z-10 border-b border-r bg-card p-3 text-left font-medium">
                <span className="block leading-snug">{r.branch}</span>
                {r.aside}
              </th>
              {cols.map(({ date, session }) => {
                const here = r.slots.filter((s) => s.date === date && s.sessionId === session.id);
                const label = `${r.branch}, ${dayLabel(date)}${sessions.length > 1 ? `, ${session.label}` : ""}`;
                return (
                  <td key={`${date}|${session.id}`} className="border-b border-r p-1.5 last:border-r-0">
                    {onCell ? (
                      <button type="button" onClick={() => onCell(r.key, date, session.id)} title={cellTitle} aria-label={here.length ? `${label}: ${here.map((s) => s.subjectName).join(" / ")} - change` : `${label}: add a subject`}
                        className={cn("flex min-h-16 w-full items-center justify-center rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          here.length ? "bg-primary/5 ring-1 ring-primary/15 hover:bg-primary/10" : "border border-dashed text-muted-foreground hover:border-primary/50 hover:text-primary")}>
                        {here.length ? <SheetCell slots={here} /> : <Plus className="h-4 w-4" />}
                      </button>
                    ) : here.length ? <div className="p-1.5"><SheetCell slots={here} /></div> : <p className="p-2 text-center text-xs text-muted-foreground">-</p>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
