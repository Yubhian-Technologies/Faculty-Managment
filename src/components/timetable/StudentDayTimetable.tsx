"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { isoDateKey } from "@/lib/leave/dayCounter";
import { ALL_DAYS, buildTimetableColumns, periodTimeRange, resolveTimetableDays, slotShortCode, mergeCoTaughtSlots} from "@/lib/timetable/gridModel";
import { DAY_LABELS } from "@/types";
import type { CourseYearTiming, DayOfWeek, Subject, TimetableSlot } from "@/types";

interface Props {
  weekStart: Date;
  timing: CourseYearTiming;
  slots: TimetableSlot[];
  subjects: Subject[];
  workingDays?: DayOfWeek[];
  selectedDay: DayOfWeek;
  onSelectDay: (d: DayOfWeek) => void;
}

function dateOf(weekStart: Date, day: DayOfWeek): Date {
  return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + ALL_DAYS.indexOf(day));
}

function toMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

// One day at a time, built for a phone: a row of day buttons across the top
// (every working day fits, no sideways scrolling), then that day's periods in
// order - time on the left, subject on the right, breaks as thin dividers, and
// the period that is on right now marked. Substitutions are shown only on the
// date they apply to, so next Tuesday's cover never shows up on this Tuesday.
export function StudentDayTimetable({ weekStart, timing, slots, subjects, workingDays, selectedDay, onSelectDay }: Props) {
  const days = useMemo(
    () => resolveTimetableDays(workingDays ? { workingDays } : null, slots.map((s) => s.day)),
    [workingDays, slots]
  );
  const columns = useMemo(() => buildTimetableColumns(timing, { lunchLabel: "Lunch" }), [timing]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const todayKey = isoDateKey(new Date());
  const selectedKey = isoDateKey(dateOf(weekStart, selectedDay));
  const isToday = selectedKey === todayKey;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const daySlots = slots.filter((s) => s.day === selectedDay);
  const hasClasses = daySlots.length > 0;

  return (
    <div>
      <div role="tablist" aria-label="Day of the week" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const date = dateOf(weekStart, d);
          const active = d === selectedDay;
          const today = isoDateKey(date) === todayKey;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectDay(d)}
              className={cn(
                "flex flex-col items-center rounded-xl border px-1 py-2 text-center transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card hover:bg-muted/40"
              )}
            >
              <span className="text-[11px] font-medium uppercase">{DAY_LABELS[d].slice(0, 3)}</span>
              <span className="text-base font-semibold leading-tight">{date.getDate()}</span>
              <span className={cn("mt-0.5 h-0.5 w-4 rounded-full", today ? (active ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")} aria-hidden />
            </button>
          );
        })}
      </div>

      <p className="mb-2 mt-4 text-sm font-medium">
        {DAY_LABELS[selectedDay]}, {dateOf(weekStart, selectedDay).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}
      </p>

      {!hasClasses ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No classes on this day.</p>
      ) : (
        <ul className="divide-y rounded-xl border border-border/60 bg-card">
          {columns.map((col) => {
            if (col.kind === "break") {
              const range = periodTimeRange(col.startTime, col.endTime);
              return (
                <li key={col.id} className="bg-muted/30 px-3 py-1.5 text-center text-xs text-muted-foreground">
                  {col.label}
                  {range && ` · ${range}`}
                </li>
              );
            }
            // Faculty of one subject sharing the period show as one entry, subject once.
            const periodSlots = mergeCoTaughtSlots(daySlots.filter((s) => s.periodNumber === col.periodNumber));
            const start = toMinutes(col.startTime);
            const end = toMinutes(col.endTime);
            const isNow = isToday && start !== null && end !== null && nowMinutes >= start && nowMinutes < end;
            return (
              <li key={col.id} className={cn("flex gap-3 p-3", isNow && "border-l-2 border-l-primary bg-primary/5")}>
                <div className="w-20 shrink-0 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Period {col.periodNumber}</p>
                  {col.startTime && col.endTime && (
                    <p className="mt-0.5 leading-snug">
                      {periodTimeRange(col.startTime, col.endTime)?.split(" - ").map((t, i) => (
                        <span key={i} className="block">{t}</span>
                      ))}
                    </p>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {periodSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground/60">Free</p>
                  ) : (
                    periodSlots.map((s, i) => {
                      // A cover only applies on its own date.
                      const covering = s.substituteFacultyName && s.substituteDate === selectedKey;
                      const faculty = covering ? s.substituteFacultyName : s.facultyName;
                      const code = slotShortCode(s, subjectMap);
                      return (
                        <div key={s.id || i} className="min-w-0">
                          <p className="break-words text-sm font-semibold">
                            {code}
                            {s.labBatch && <span className="font-normal text-muted-foreground"> · {s.labBatch}</span>}
                          </p>
                          {s.subjectName && s.subjectName !== code && <p className="break-words text-xs text-muted-foreground">{s.subjectName}</p>}
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {covering ? `Substitute: ${faculty}` : faculty || "Faculty not assigned"}
                            {s.classroom && ` · Room ${s.classroom}`}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
