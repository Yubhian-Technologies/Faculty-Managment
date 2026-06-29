/**
 * Counts leave days between fromDate and toDate (inclusive).
 *
 * For leave types with excludeHolidaysAndSundays=true (e.g. CL):
 *   - Sundays are not counted
 *   - Dates in holidayDates set are not counted
 *
 * For leave types with excludeHolidaysAndSundays=false (e.g. EL, ML):
 *   - All calendar days are counted
 */
export function countLeaveDays(
  fromDate: Date,
  toDate: Date,
  options: {
    excludeHolidaysAndSundays: boolean;
    holidayDates: Set<string>; // "YYYY-MM-DD"
  }
): number {
  if (toDate < fromDate) return 0;

  let count = 0;
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    if (options.excludeHolidaysAndSundays) {
      const isSunday = cursor.getDay() === 0;
      const dateStr = toDateString(cursor);
      const isHoliday = options.holidayDates.has(dateStr);
      if (!isSunday && !isHoliday) count++;
    } else {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yearsOfService(dateOfJoining: Date, today: Date): number {
  const ms = today.getTime() - dateOfJoining.getTime();
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
}
