import { getISTParts } from "@/lib/attendance/istTime";

/**
 * Parses time strings in "HH:mm" (24h) or "hh:mm AM/PM" (12h) to total minutes from midnight (0..1439).
 */
export function parseTimeToMinutes(timeStr: string): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim();

  // Match "08:45 AM" or "8:45 PM"
  const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // Match "14:30" or "06:00"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Formats minutes from midnight (0..1439) into "hh:mm AM/PM" (12h IST string).
 */
export function formatMinutesTo12h(totalMinutes: number): string {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(norm / 60);
  const minutes = norm % 60;
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/**
 * Gets the current IST time in total minutes from midnight.
 */
export function getCurrentISTMinutes(): number {
  const { hour, minute } = getISTParts(new Date());
  return hour * 60 + minute;
}

/**
 * Evaluates whether a check-in is late compared to scheduled shift start time and grace period.
 * Example: Shift 06:00, Grace 15m.
 * Check-in at 06:10 -> ON_TIME (isLate: false)
 * Check-in at 06:20 -> LATE (isLate: true, lateMinutes: 5)
 */
export function evaluateCheckInTiming(
  checkInTimeStr: string,
  shiftStartTimeStr: string,
  gracePeriodMinutes = 15
): {
  isLate: boolean;
  lateMinutes: number;
  timingStatus: "ON_TIME" | "LATE" | "EARLY";
} {
  const checkInMins = parseTimeToMinutes(checkInTimeStr);
  const shiftStartMins = parseTimeToMinutes(shiftStartTimeStr);

  if (checkInMins === null || shiftStartMins === null) {
    return { isLate: false, lateMinutes: 0, timingStatus: "ON_TIME" };
  }

  const allowableThreshold = shiftStartMins + gracePeriodMinutes;

  if (checkInMins > allowableThreshold) {
    return {
      isLate: true,
      lateMinutes: checkInMins - allowableThreshold,
      timingStatus: "LATE",
    };
  }

  if (checkInMins < shiftStartMins) {
    return {
      isLate: false,
      lateMinutes: 0,
      timingStatus: "EARLY",
    };
  }

  return {
    isLate: false,
    lateMinutes: 0,
    timingStatus: "ON_TIME",
  };
}

/**
 * Evaluates whether a check-out is out of scheduled shift timing (e.g. left early or out-of-time).
 * Example: Shift 06:00 to 14:00.
 * Check-out at 13:30 -> OUT_OF_TIME (isEarly: true, diffMinutes: 30)
 * Check-out at 14:05 -> ON_TIME
 */
export function evaluateCheckOutTiming(
  checkOutTimeStr: string,
  shiftStartTimeStr: string,
  shiftEndTimeStr: string,
  earlyThresholdMinutes = 15
): {
  isOutOfTime: boolean;
  isEarly: boolean;
  diffMinutes: number;
  timingStatus: "ON_TIME" | "EARLY" | "OVERTIME" | "OUT_OF_TIME";
} {
  const checkOutMins = parseTimeToMinutes(checkOutTimeStr);
  const shiftStartMins = parseTimeToMinutes(shiftStartTimeStr);
  const shiftEndMins = parseTimeToMinutes(shiftEndTimeStr);

  if (checkOutMins === null || shiftEndMins === null) {
    return { isOutOfTime: false, isEarly: false, diffMinutes: 0, timingStatus: "ON_TIME" };
  }

  // Handle overnight shift: e.g. 22:00 to 06:00
  let normEnd = shiftEndMins;
  let normCheckOut = checkOutMins;
  if (shiftStartMins !== null && shiftEndMins < shiftStartMins) {
    normEnd += 1440;
    if (checkOutMins < shiftStartMins) {
      normCheckOut += 1440;
    }
  }

  // If checked out earlier than shift end minus early threshold (e.g. left early)
  if (normCheckOut < normEnd - earlyThresholdMinutes) {
    return {
      isOutOfTime: true,
      isEarly: true,
      diffMinutes: normEnd - normCheckOut,
      timingStatus: "EARLY",
    };
  }

  // If checked out far after shift (e.g., > 120 minutes after shift end without formal overtime)
  if (normCheckOut > normEnd + 60) {
    return {
      isOutOfTime: true,
      isEarly: false,
      diffMinutes: normCheckOut - normEnd,
      timingStatus: "OUT_OF_TIME",
    };
  }

  return {
    isOutOfTime: false,
    isEarly: false,
    diffMinutes: 0,
    timingStatus: "ON_TIME",
  };
}

/**
 * Determines whether a shift is currently ACTIVE, UPCOMING, or COMPLETED right now (IST).
 */
export function getShiftCurrentState(
  startTimeStr: string,
  endTimeStr: string
): "ACTIVE" | "UPCOMING" | "COMPLETED" {
  const startMins = parseTimeToMinutes(startTimeStr);
  const endMins = parseTimeToMinutes(endTimeStr);
  if (startMins === null || endMins === null) return "ACTIVE";

  const nowMins = getCurrentISTMinutes();

  // Standard same-day shift: e.g. 06:00 - 14:00
  if (endMins > startMins) {
    if (nowMins < startMins) return "UPCOMING";
    if (nowMins > endMins) return "COMPLETED";
    return "ACTIVE";
  }

  // Overnight shift: e.g. 22:00 - 06:00
  if (nowMins >= startMins || nowMins <= endMins) {
    return "ACTIVE";
  }
  return nowMins < startMins && nowMins > endMins ? "UPCOMING" : "COMPLETED";
}
