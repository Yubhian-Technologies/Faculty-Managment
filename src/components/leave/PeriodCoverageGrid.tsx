import type { ReactNode } from "react";
import { formatDate } from "@/lib/utils";

export interface PeriodCoverageEntry {
  date: string;
  day: string;
  periodNumber: number;
  timetableSlotId: string;
  sectionName?: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string; facultyDepartment?: string }[];
}

interface PeriodCoverageGridProps {
  periods: PeriodCoverageEntry[];
  // Callers keep their own picker/state (a plain Select in LeaveApplyForm and
  // AdjustCoverageDialog, an Adjustment/Replacement toggle in
  // LeaveApprovalQueue) - this component only owns the grouping/layout, not
  // what's picked for each period.
  renderPeriod: (period: PeriodCoverageEntry, key: string) => ReactNode;
}

// Every period-substitute picker in the leave module (LeaveApplyForm,
// AdjustCoverageDialog, LeaveApprovalQueue's coverage adjustment) used to list
// periods as one flat row per period, dates interleaved with no grouping. This
// groups them by date instead - each date's own periods sit together, laid
// out up to 3 to a row (Period 1, 2, 3, then wrapping to a new row for a 4th+)
// rather than one per line, since a teaching day rarely has more than a
// handful of periods and reads far more compactly as a small grid than a long
// vertical scroll. Sorted by date, then by period number within a date,
// regardless of the order the API returned them in.
export function PeriodCoverageGrid({ periods, renderPeriod }: PeriodCoverageGridProps) {
  const byDate = new Map<string, PeriodCoverageEntry[]>();
  for (const p of periods) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date)!.push(p);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <div className="space-y-3">
      {dates.map((date) => {
        const dayPeriods = [...byDate.get(date)!].sort((a, b) => a.periodNumber - b.periodNumber);
        return (
          <div key={date} className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">
              {formatDate(new Date(date))}
              {dayPeriods[0]?.day ? <span className="font-normal text-muted-foreground"> · {dayPeriods[0].day}</span> : null}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {dayPeriods.map((p) => renderPeriod(p, `${p.date}|${p.timetableSlotId}`))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
