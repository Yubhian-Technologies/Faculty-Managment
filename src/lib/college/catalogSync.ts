// A Course Catalog entry is the source of truth for a programme's name, code and length. Each department's
// Course doc stores a COPY of them (created from the catalog - courses POST, courses/[id] PATCH), and every
// downstream check reads that copy: year ceilings (sections, students, exam configurations, promotion's
// "final year"), pickers, labels. Editing the catalog used to write the catalog only, so changing a 4-year
// course to 5 left year 5 rejected everywhere and a rename left the old name on every department's course.
//
// Keeping the copy (rather than removing it) is deliberate: ~60 readers use course.name / course.durationYears
// directly, so the safe fix is to keep the copies in step on every catalog edit:
//  - courseSyncPatches: PURE. What each Course doc must change to match the catalog (nothing for a doc already in step).
//  - findShrinkBlocker: a course can't be shortened while years beyond the new length are still taught or hold data.
//  - cascadeCourseRename: a rename also refreshes the LIVE copies of the name - students.course (a match key
//    that student lists filter on), sections.courseName and teachingAssignments.courseName. Historical
//    snapshots (exam circulars, mid schedules, candidate applications) are left as they were written.

import { countSlotDependents, describeCounts, sumCounts } from "@/lib/departments/yearDependents";

export interface CatalogValues {
  name: string;
  code: string;
  durationYears: number;
}

export interface CourseDocLite {
  id: string;
  departmentId?: string;
  name?: string;
  code?: string;
  durationYears?: number;
}

export interface CoursePatch {
  id: string;
  patch: Partial<CatalogValues>;
}

/** What each Course doc must change so it matches the catalog values in `next`. Docs already equal are omitted. */
export function courseSyncPatches(courses: CourseDocLite[], next: Partial<CatalogValues>): CoursePatch[] {
  const out: CoursePatch[] = [];
  for (const c of courses) {
    const patch: Partial<CatalogValues> = {};
    if (next.name !== undefined && c.name !== next.name) patch.name = next.name;
    if (next.code !== undefined && c.code !== next.code) patch.code = next.code;
    if (next.durationYears !== undefined && Number(c.durationYears) !== next.durationYears) patch.durationYears = next.durationYears;
    if (Object.keys(patch).length > 0) out.push({ id: c.id, patch });
  }
  return out;
}

/**
 * Refusal text when shortening the course to `nextDuration` would strand anything, else null.
 *  - a department's Years Taught for this programme still lists a year past the new length, or
 *  - sections / students / assignments / slots / subject assignments / timings / exam configurations still exist
 *    in a year past the new length.
 * `longest` is the longest length currently stored (the catalog's, or a Course doc's if one drifted longer).
 */
export async function findShrinkBlocker(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  catalogId: string,
  courses: CourseDocLite[],
  longest: number,
  nextDuration: number
): Promise<string | null> {
  if (nextDuration >= longest) return null;
  const college = db.collection("colleges").doc(collegeId);
  const courseIds = courses.map((c) => c.id);
  const names = Array.from(new Set(courses.map((c) => c.name ?? "").filter(Boolean)));

  // 1. Years Taught beyond the new length.
  const deptSnap = await college.collection("departments").get();
  const ownerIds = new Set(courses.map((c) => c.departmentId ?? ""));
  const stillTaught: string[] = [];
  for (const d of deptSnap.docs) {
    const data = d.data() as { name?: string; assignedYears?: number[]; courseScopes?: Record<string, { assignedYears?: number[] }> };
    const own = data.courseScopes?.[catalogId]?.assignedYears;
    const years = own ?? (ownerIds.has(d.id) ? data.assignedYears ?? [] : []);
    const beyond = years.filter((y) => y > nextDuration);
    if (beyond.length > 0) stillTaught.push(`${data.name ?? d.id} (Year ${beyond.join(", ")})`);
  }
  if (stillTaught.length > 0) {
    return `Can't shorten this course to ${nextDuration} year${nextDuration === 1 ? "" : "s"}: ${stillTaught.slice(0, 5).join("; ")} still teach${stillTaught.length === 1 ? "es" : ""} later years. Remove those years from the department's Years Taught first. Nothing was changed.`;
  }

  // 2. Data filed under a year past the new length.
  for (let year = nextDuration + 1; year <= longest; year++) {
    const counts = await countSlotDependents(db, collegeId, { year, courseIds, courseNames: names, ownCourseIds: courseIds });
    if (sumCounts(counts) > 0) {
      return `Can't shorten this course to ${nextDuration} year${nextDuration === 1 ? "" : "s"}: Year ${year} still has ${describeCounts(counts)}. Move or remove that data first. Nothing was changed.`;
    }
  }
  return null;
}

type Db = FirebaseFirestore.Firestore;

async function commitInChunks(db: Db, updates: { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 400)) batch.update(u.ref, u.patch);
    await batch.commit();
  }
}

export interface CourseRenameCascadeResult {
  failedStep?: string;
  error?: string;
}

/**
 * Refreshes the live copies of a course's name after a catalog rename. Idempotent - a doc already holding
 * `newName` drops out of a retry's queries - so a partial failure is safe to re-run.
 * Matches by courseId (sections, assignments, students that have one) and, for students that carry only the
 * name text, by `oldName`.
 */
export async function cascadeCourseRename(
  db: Db,
  collegeId: string,
  courseIds: string[],
  oldName: string,
  newName: string
): Promise<CourseRenameCascadeResult> {
  const college = db.collection("colleges").doc(collegeId);
  const now = new Date();
  const steps: { label: string; run: () => Promise<void> }[] = [];

  const byCourseId = (collection: string, field: string) => async () => {
    const updates: { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }[] = [];
    for (let i = 0; i < courseIds.length; i += 30) {
      const snap = await college.collection(collection).where("courseId", "in", courseIds.slice(i, i + 30)).get();
      for (const d of snap.docs) {
        if ((d.data() as Record<string, unknown>)[field] !== newName) updates.push({ ref: d.ref, patch: { [field]: newName, updatedAt: now } });
      }
    }
    await commitInChunks(db, updates);
  };
  steps.push({ label: "sections.courseName", run: byCourseId("sections", "courseName") });
  steps.push({ label: "teachingAssignments.courseName", run: byCourseId("teachingAssignments", "courseName") });
  steps.push({ label: "students.course(courseId)", run: byCourseId("students", "course") });
  steps.push({
    label: "students.course(name)",
    run: async () => {
      if (!oldName || oldName === newName) return;
      const snap = await college.collection("students").where("course", "==", oldName).get();
      // Only students that are this course's: no courseId (older rows) or one of this course's own ids.
      const mine = snap.docs.filter((d) => {
        const cid = (d.data() as { courseId?: string }).courseId;
        return !cid || courseIds.includes(cid);
      });
      await commitInChunks(db, mine.map((d) => ({ ref: d.ref, patch: { course: newName, updatedAt: now } })));
    },
  });

  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      return { failedStep: step.label, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return {};
}
