"use client";

import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

/**
 * A Mid timetable as a table: one row per exam day, one column per session,
 * each cell the subject written then. `days` lists every exam day (the builder's
 * preview shows the empty ones too); viewers pass only the days with an exam.
 */
export function MidTimetableGrid({ slots, sessions, days }: { slots: MidExamSlot[]; sessions: MidExamSession[]; days?: string[] }) {
  const list = days ?? [...new Set(slots.map((s) => s.date))].sort();
  if (list.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No exams placed yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-40 p-3 font-medium">Date</th>
            {sessions.map((s) => (
              <th key={s.id} className="p-3 font-medium">{s.label}<span className="block font-normal">{timeLabel(s.from)} - {timeLabel(s.to)}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((day) => (
            <tr key={day} className="border-t align-top">
              <td className="p-3 font-medium">{dayLabel(day)}</td>
              {sessions.map((s) => {
                const slot = slots.find((x) => x.date === day && x.sessionId === s.id);
                return (
                  <td key={s.id} className="p-3">
                    {slot ? (
                      <div className="rounded-lg bg-primary/5 px-2.5 py-1.5 ring-1 ring-primary/15">
                        <p className="font-medium leading-snug">{slot.subjectName}</p>
                        <p className="text-xs text-muted-foreground">{slot.subjectCode}</p>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">-</span>}
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
