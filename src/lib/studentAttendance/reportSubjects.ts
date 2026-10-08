// Which subjects a staff attendance report counts. A student's own view counts every
// subject that has a submitted session in range; the staff reports used to count only
// subjects with a CURRENT teaching assignment, so a subject whose assignment ended or
// moved semester dropped out and the same student got two different percentages.
//
// ATTENDANCE_REPORT_ALL_SUBJECTS=1 makes the reports add those subjects (union with the
// current list, so column order and the current subjects are unchanged). Off by default:
// it changes published percentages, so it is switched on deliberately, after comparing.

export const reportCountsAllSubjects = (): boolean => process.env.ATTENDANCE_REPORT_ALL_SUBJECTS === "1";

interface SubjectLike { subjectId: string; subjectName?: string; subjectCode?: string }

/** `current` plus any subject that appears in `sessions` but not in `current` (appended, sorted by name). */
export function withSessionSubjects<T extends { subjectId: string; subjectName: string; subjectCode: string }>(
  current: T[], sessions: SubjectLike[]
): T[] {
  const known = new Set(current.map((s) => s.subjectId));
  const extra = new Map<string, T>();
  for (const s of sessions) {
    if (known.has(s.subjectId) || extra.has(s.subjectId)) continue;
    extra.set(s.subjectId, { subjectId: s.subjectId, subjectName: s.subjectName ?? "", subjectCode: s.subjectCode ?? "" } as T);
  }
  return [...current, ...Array.from(extra.values()).sort((a, b) => a.subjectName.localeCompare(b.subjectName))];
}
