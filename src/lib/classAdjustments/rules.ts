import type { ClassAdjustmentLeg, TimetableSlot } from "@/types";

// Pure rules of "Adjust / Swap a Class" (types/classAdjustment.ts). No Firestore here.

/** How far ahead an adjustment may be arranged (days after today). */
export const MAX_DAYS_AHEAD = 14;
export const MAX_REASON = 300;

/** A leg in force on a date, with the adjustment it belongs to. */
export interface LegInForce extends ClassAdjustmentLeg {
  adjustmentId: string;
}

/** What a period handed over carries, so lists and the attendance write can tell it apart. */
export interface AdjustedFrom {
  /** The class adjustment's id, or "LEAVE" for a leave substitute teaching their own subject. */
  adjustmentId: string;
  fromFacultyId: string;
  fromFacultyName: string;
  fromSubjectName: string;
}

export type AdjustableSlot = TimetableSlot & { id: string; adjustedFrom?: AdjustedFrom };

function samePlacement(slot: Pick<TimetableSlot, "sectionId" | "day" | "periodNumber" | "subjectId" | "facultyId">, leg: ClassAdjustmentLeg): boolean {
  // A republished timetable recreates slots with new ids - the placement still identifies the period.
  return slot.sectionId === leg.sectionId && slot.day === leg.day && slot.periodNumber === leg.periodNumber
    && slot.subjectId === leg.fromSubjectId && slot.facultyId === leg.fromFacultyId;
}

/** True when `slot` is a period its own faculty handed to someone else on that date. */
export function isGivenAway(slot: Pick<TimetableSlot, "sectionId" | "day" | "periodNumber" | "subjectId" | "facultyId"> & { id: string }, legs: LegInForce[]): boolean {
  return legs.some((l) => l.fromFacultyId === slot.facultyId && (l.slotId === slot.id || samePlacement(slot, l)));
}

/** The period as the taker teaches it: the giver's slot, with the taker's own assignment and subject. */
export function virtualSlotFor(leg: LegInForce, collegeId: string): AdjustableSlot {
  return {
    id: `${leg.slotId}__adj_${leg.adjustmentId}`,
    collegeId,
    department: leg.department,
    assignmentId: leg.toAssignmentId,
    facultyId: leg.toFacultyId,
    facultyName: leg.toFacultyName,
    courseId: leg.courseId,
    year: leg.year,
    ...(leg.semester != null ? { semester: leg.semester } : {}),
    sectionId: leg.sectionId,
    subjectId: leg.toSubjectId,
    subjectName: leg.toSubjectName,
    day: leg.day,
    periodNumber: leg.periodNumber,
    ...(leg.classroom ? { classroom: leg.classroom } : {}),
    adjustedFrom: {
      adjustmentId: leg.adjustmentId,
      fromFacultyId: leg.fromFacultyId,
      fromFacultyName: leg.fromFacultyName,
      fromSubjectName: leg.fromSubjectName,
    },
  } as AdjustableSlot;
}

/**
 * A faculty member's periods on the date after the adjustments in force: periods they handed over are dropped,
 * periods handed to them are added (as their own subject). `onlyAssignmentId` keeps just that assignment's
 * added periods (the attendance write gate).
 */
export function applyAdjustments<T extends TimetableSlot & { id: string }>(
  ownSlots: T[],
  legs: LegInForce[],
  facultyId: string,
  collegeId: string,
  opts: { onlyAssignmentId?: string } = {},
): (T | AdjustableSlot)[] {
  if (legs.length === 0) return ownSlots;
  const kept: (T | AdjustableSlot)[] = ownSlots.filter((s) => !isGivenAway(s, legs));
  for (const leg of legs) {
    if (leg.toFacultyId !== facultyId) continue;
    if (opts.onlyAssignmentId && leg.toAssignmentId !== opts.onlyAssignmentId) continue;
    kept.push(virtualSlotFor(leg, collegeId));
  }
  return kept;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Two clock ranges ("HH:MM") share any minute. */
export function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return false;
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/** The first of `periods` that clashes with `window`, ignoring the slots in `ignore` (the ones being swapped). */
export function clashWith<P extends { slotId: string; startTime: string; endTime: string }>(
  periods: P[], window: { startTime: string; endTime: string }, ignore: string[] = [],
): P | null {
  return periods.find((p) => !ignore.includes(p.slotId) && overlaps(p, window)) ?? null;
}

/** A date an adjustment can be arranged for: today up to MAX_DAYS_AHEAD days on. Returns an error message or null. */
export function dateProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Select a date.";
  if (date < today) return "A class can only be adjusted for today or a later date.";
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + MAX_DAYS_AHEAD);
  if (date > max.toISOString().slice(0, 10)) return `A class can be adjusted up to ${MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

/** "Period 3 (10:40-11:30)" */
export function periodLabel(p: { periodNumber: number; startTime?: string; endTime?: string }): string {
  return p.startTime && p.endTime ? `Period ${p.periodNumber} (${p.startTime}-${p.endTime})` : `Period ${p.periodNumber}`;
}

/** The lock doc id that keeps one period in at most one open adjustment. */
export function slotLockId(date: string, leg: Pick<ClassAdjustmentLeg, "sectionId" | "day" | "periodNumber" | "fromFacultyId">): string {
  return `${date}__${leg.sectionId}__${leg.day}__P${leg.periodNumber}__${leg.fromFacultyId}`;
}

/** The subject a colleague teaches in a section they take over: theory first, then by name. */
export function pickOwnAssignment<A extends { subjectType?: string; subjectName?: string }>(list: A[]): A | null {
  if (!list.length) return null;
  const rank = (a: A) => (a.subjectType === "THEORY" || !a.subjectType ? 0 : 1);
  return [...list].sort((x, y) => rank(x) - rank(y) || (x.subjectName ?? "").localeCompare(y.subjectName ?? ""))[0];
}
