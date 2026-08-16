import { isSunday } from "./attendanceWindow";
import { toAttendanceDate } from "./closeMissedCheckouts";
import type { AttendanceRecord } from "@/types";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface FillContext {
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
}

// Synthesizes a display-only Absent/Holiday entry (never persisted to
// Firestore) for any day in [monthStart, monthEnd) that has no real
// attendanceRecords doc, starting from the person's face-registration date -
// before that, or for today/future days, the day is left out entirely,
// exactly like a day with nothing to show has always rendered. Sundays
// synthesize as Holiday, matching the fixed weekly rule self check-in
// already enforces live (see isSunday). Approved leave and the office
// Holidays calendar are still NOT cross-referenced here - deliberately
// deferred, same as the NOT_REGISTERED/NOT_MARKED roster split.
export function fillMissingDays(
  realRecords: (AttendanceRecord & { id: string })[],
  monthStart: Date,
  monthEnd: Date,
  registeredAt: Date | null,
  ctx: FillContext,
  now: Date = new Date()
): (AttendanceRecord & { id: string })[] {
  const byKey = new Map(
    realRecords.map((r) => [dateKey(toAttendanceDate(r.date) ?? new Date(0)), r])
  );
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const regStart = registeredAt
    ? new Date(registeredAt.getFullYear(), registeredAt.getMonth(), registeredAt.getDate())
    : null;

  const filled = [...realRecords];
  for (const cursor = new Date(monthStart); cursor < monthEnd; cursor.setDate(cursor.getDate() + 1)) {
    const day = new Date(cursor);
    if (day >= todayStart) continue; // today/future - not judged yet
    if (!regStart || day < regStart) continue; // before registration - leave as no record
    const key = dateKey(day);
    if (byKey.has(key)) continue; // a real record already covers this day

    const status = isSunday(day) ? "HOLIDAY" : "ABSENT";
    filled.push({
      id: `synthetic_${key}`,
      collegeId: ctx.collegeId,
      facultyId: ctx.facultyId,
      facultyName: ctx.facultyName,
      department: ctx.department,
      date: day as unknown as AttendanceRecord["date"],
      status,
      source: "SYSTEM",
      ...(status === "ABSENT" ? { remarks: "No check-in recorded" } : {}),
      createdAt: day as unknown as AttendanceRecord["createdAt"],
      updatedAt: day as unknown as AttendanceRecord["updatedAt"],
    } as AttendanceRecord & { id: string });
  }

  return filled.sort((a, b) => {
    const da = toAttendanceDate(a.date)?.getTime() ?? 0;
    const dbv = toAttendanceDate(b.date)?.getTime() ?? 0;
    return da - dbv;
  });
}
