/**
 * A teaching assignment copies its subject instance's `hoursPerWeek`, because
 * that value caps how many timetable periods the assignment may hold. When the
 * instance is saved, the drifted copies are brought back into step - except
 * where doing so would leave a timetable over its own cap.
 *
 * The rule that matters here is WHOSE DOING the over-placement is.
 *
 * An editor saving the Academics > Subjects dialog sends every field, so a save
 * that only changes a short code still arrives carrying the same L-T-P it
 * already had. The refusal used to be decided from the placed periods alone, so
 * any assignment that was already over its cap blocked every later save of that
 * subject - including ones that never touched an hour. At VISHNU WOMEN'S
 * UNIVERSITY, "Programming for Problem Solving" carried hoursPerWeek 4 with 4
 * periods placed while its instance said 3, and renaming its short code was
 * refused with "Can't lower hours below the periods already placed".
 *
 * So: refuse only when this save actually changes the hours. When it does not,
 * the over-placement predates the save, and the assignment is left exactly as
 * it is - neither refused nor quietly lowered, which would put its timetable
 * over the cap instead.
 */

export interface HoursSyncCandidate {
  /** The teaching assignment whose copied hoursPerWeek has drifted. */
  id: string;
  /** Timetable periods currently placed against it. */
  placedPeriods: number;
}

export interface HoursSyncPlan {
  /** Assignments to update to the new hoursPerWeek. */
  syncIds: string[];
  /** Assignments the caller must refuse over - empty unless the hours changed. */
  blockedIds: string[];
}

export function planHoursSync(
  candidates: HoursSyncCandidate[],
  hoursPerWeek: number,
  hoursChanged: boolean
): HoursSyncPlan {
  const over = candidates.filter((c) => c.placedPeriods > hoursPerWeek);
  if (over.length > 0 && hoursChanged) {
    return { syncIds: [], blockedIds: over.map((c) => c.id) };
  }
  const overIds = new Set(over.map((c) => c.id));
  return { syncIds: candidates.filter((c) => !overIds.has(c.id)).map((c) => c.id), blockedIds: [] };
}
