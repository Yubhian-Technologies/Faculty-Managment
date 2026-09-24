import type { PeriodAttendanceStatus } from "@/lib/attendance/periodAttendanceStatus";

export interface PeriodSlotWithStatus {
  periodNumber: number;
  startTime: string;
  endTime: string;
  assignmentId: string;
  status: PeriodAttendanceStatus; // ON_TIME|LATE|NOT_MARKED|PENDING
}

export interface NotPostedAgg {
  totalPeriods: number;
  onTime: number;
  late: number;
  notMarked: number;
  pending: number;
  notPosted: number; // NOT_MARKED count
}

export function aggregateNotPosted(slots: PeriodSlotWithStatus[]): NotPostedAgg {
  let onTime = 0, late = 0, notMarked = 0, pending = 0;
  for (const s of slots) {
    if (s.status === "ON_TIME") onTime++;
    else if (s.status === "LATE") late++;
    else if (s.status === "NOT_MARKED") notMarked++;
    else if (s.status === "PENDING") pending++;
  }
  return { totalPeriods: slots.length, onTime, late, notMarked, pending, notPosted: notMarked };
}
