import { whereIn } from "@/lib/firestore/inQuery";

// The curriculum order of subjects: each semester assignment's `serialNumber` (the Course Structure as the Dean
// Academics uploaded / last arranged it - SubjectSemesterAssignment.serialNumber). Every list that shows "the
// semester's subjects" side by side - the subject list under a timetable, the Student Attendance report's columns -
// uses it, so they read in the same order. A subject with no serial goes after those with one, by code.

/** subjectId -> curriculum position. With `department`, that department's own assignment wins (a subject shared by
 * branches may sit at a different place in each); otherwise the smallest position found. */
export async function curriculumSerials(
  collegeRef: FirebaseFirestore.DocumentReference,
  subjectIds: readonly string[],
  department?: string,
): Promise<Map<string, number>> {
  const ids = [...new Set(subjectIds.filter(Boolean))];
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const snap = await whereIn(collegeRef.collection("subjectSemesterAssignments"), "subjectId", ids).get();
  const own = new Map<string, number>();
  for (const d of snap.docs) {
    const a = d.data() as { subjectId?: string; serialNumber?: number; department?: string; isActive?: boolean };
    if (!a.subjectId || typeof a.serialNumber !== "number" || a.isActive === false) continue;
    if (department && a.department === department) own.set(a.subjectId, Math.min(own.get(a.subjectId) ?? Infinity, a.serialNumber));
    out.set(a.subjectId, Math.min(out.get(a.subjectId) ?? Infinity, a.serialNumber));
  }
  for (const [k, v] of own) out.set(k, v);
  return out;
}

/** Curriculum position first (none = last), then subject code (numeric-aware), then name. */
export function compareCurriculum(
  a: { serial?: number | null; code?: string; name?: string },
  b: { serial?: number | null; code?: string; name?: string },
): number {
  const sa = a.serial ?? Number.MAX_SAFE_INTEGER, sb = b.serial ?? Number.MAX_SAFE_INTEGER;
  return sa - sb
    || (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true })
    || (a.name ?? "").localeCompare(b.name ?? "");
}

/** Subject docs sent to a timetable page, each with its `curriculumSerial` (display only, never stored), so the
 * subject list under the grid follows the curriculum order (gridModel.buildAllocationList). */
export async function withCurriculumSerial<T extends { id: string }>(
  collegeRef: FirebaseFirestore.DocumentReference,
  subjects: T[],
  department?: string,
): Promise<(T & { curriculumSerial?: number })[]> {
  const serials = await curriculumSerials(collegeRef, subjects.map((s) => s.id), department).catch(() => new Map<string, number>());
  return subjects.map((s) => (serials.has(s.id) ? { ...s, curriculumSerial: serials.get(s.id) } : s));
}

const GROUP_RANK: Record<string, number> = { THEORY: 0, PRACTICAL: 1, TUTORIAL: 2, PROJECT: 3, NON_TEACHING: 4 };

/** Which block a subject is listed in, in the timetable's order (timetableHeader.groupAllocationByType): Theory,
 * Practical, Tutorial, Project, then Co-Curricular ("Don't include in teaching load"). No recorded type = Practical
 * when the name says lab / practical, else Theory - the same rule. */
export function subjectGroupRank(s: { type?: string | null; isNonTeachingLoad?: boolean; name?: string }): number {
  if (s.isNonTeachingLoad) return GROUP_RANK.NON_TEACHING;
  if (s.type && s.type in GROUP_RANK) return GROUP_RANK[s.type];
  return /\b(lab|laboratory|practical)\b/i.test(s.name ?? "") ? GROUP_RANK.PRACTICAL : GROUP_RANK.THEORY;
}
