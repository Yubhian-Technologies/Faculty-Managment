import type { TeachingAssignment } from "@/types";

// Nothing previously checked whether a TeachingAssignment's planned
// `hoursPerWeek` actually matches how many periods got placed for it on the
// timetable - the two live in completely separate collections with no link
// back. This is deliberately a warning, not a hard constraint: unlike
// TimetableRules (double-booking, daily caps, ...), which the server rejects
// a placement for outright, a mid-build section is normal and shouldn't be
// forced "complete" before it can be saved - see TimetableGridEditor, which
// surfaces this without blocking Publish.

/** Periods already placed for one assignment - each placed period counts as
 * one hour, the same unit TeachingAssignment.hoursPerWeek and
 * TimetableRules/CourseYearTiming already treat period count as. */
export function placedHoursForAssignment(
  assignmentId: string,
  slots: { assignmentId: string }[],
): number {
  return slots.filter((s) => s.assignmentId === assignmentId).length;
}

export type HoursMatchStatus = "under" | "match" | "over";

export function hoursMatchStatus(hoursPerWeek: number, placed: number): HoursMatchStatus {
  if (placed < hoursPerWeek) return "under";
  if (placed > hoursPerWeek) return "over";
  return "match";
}

export interface HoursMismatch {
  assignmentId: string;
  subjectName: string;
  facultyName: string;
  hoursPerWeek: number;
  placed: number;
  status: Exclude<HoursMatchStatus, "match">;
}

/** Every assignment whose placed periods don't sum to its own hoursPerWeek target. */
export function findHoursMismatches(
  assignments: Pick<TeachingAssignment, "id" | "subjectName" | "facultyName" | "hoursPerWeek">[],
  slots: { assignmentId: string }[],
): HoursMismatch[] {
  const mismatches: HoursMismatch[] = [];
  for (const a of assignments) {
    const placed = placedHoursForAssignment(a.id, slots);
    const status = hoursMatchStatus(a.hoursPerWeek, placed);
    if (status !== "match") {
      mismatches.push({
        assignmentId: a.id,
        subjectName: a.subjectName,
        facultyName: a.facultyName,
        hoursPerWeek: a.hoursPerWeek,
        placed,
        status,
      });
    }
  }
  return mismatches;
}
