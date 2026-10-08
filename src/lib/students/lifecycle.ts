import type { Section, StudentRecord } from "@/types";

// Holding a student back is two steps, because the junior batch's sections may not exist yet
// when someone is detained (e.g. mid-semester):
//   1. DETAIN  - flag the student. They stay where they are; nothing is moved.
//   2. PLACE   - later, when the cohort is promoted or the junior batch's sections exist, put
//                them into a section of the SAME year (they did not complete it) belonging to a
//                junior batch. They are then an ordinary student of that section again.
// Pure - it decides, the route writes.

type DetainableStudent = Pick<StudentRecord, "status" | "year" | "department" | "section" | "courseId"> & { batch?: string };
type TargetSection = Pick<Section, "name" | "year" | "department" | "courseId" | "courseName" | "secondaryDepartments"> & { batch?: string };

/** First year of an admission batch ("2024-2028" / "2024-28" -> 2024); null when it has none. */
export function batchStartYear(batch: string | undefined | null): number | null {
  const m = /(\d{4})/.exec(batch ?? "");
  return m ? Number(m[1]) : null;
}

/** True unless both batches are known and the target is NOT a later (junior) one. */
export function isJuniorBatch(studentBatch: string | undefined, targetBatch: string | undefined): boolean {
  const a = batchStartYear(studentBatch);
  const b = batchStartYear(targetBatch);
  return a == null || b == null || b > a;
}

export type LifecyclePlan = { ok: true; update: Record<string, unknown> } | { ok: false; reason: string };

/** Step 1: flag the student as detained. Placement (section, year) is untouched. */
export function planDetain(student: DetainableStudent, opts: { now: Date; reason?: string }): LifecyclePlan {
  if (student.status === "GRADUATED") return { ok: false, reason: "A graduated student can't be detained" };
  if (student.status === "DISCONTINUED") return { ok: false, reason: "A discontinued student can't be detained" };
  if (student.status === "DETAINED") return { ok: false, reason: "The student is already detained" };
  return {
    ok: true,
    update: {
      status: "DETAINED",
      detainedAt: opts.now,
      detainedReason: opts.reason ?? "",
      detainedFromYear: student.year,
      detainedFromSection: student.section || "",
      detainedFromDepartment: student.department,
      updatedAt: opts.now,
    },
  };
}

/** Step 2: place a detained student into the section they repeat the year in. */
export function planPlacement(
  student: DetainableStudent,
  target: TargetSection,
  opts: { studentCatalogId?: string; targetCatalogId?: string; now: Date },
): LifecyclePlan {
  if (student.status !== "DETAINED") return { ok: false, reason: "Only a detained student can be placed to repeat the year" };
  if (target.year !== student.year) {
    return { ok: false, reason: `A detained student repeats the same year - pick a Year ${student.year} section` };
  }
  if (target.name === student.section && target.department === student.department && (target.courseId ?? null) === (student.courseId ?? null)) {
    return { ok: false, reason: "The student is already in this section - pick the section they will repeat the year in" };
  }
  if (!isJuniorBatch(student.batch, target.batch)) {
    return { ok: false, reason: "A detained student joins a junior batch - pick a section of a later batch" };
  }
  if (opts.studentCatalogId && opts.targetCatalogId && opts.studentCatalogId !== opts.targetCatalogId) {
    return { ok: false, reason: "The section belongs to a different programme" };
  }
  const secondary = target.secondaryDepartments ?? [];
  return {
    ok: true,
    update: {
      // Back to an ordinary student of the new section, so the year-end promotion picks them up.
      status: "REGULAR",
      detainedPlacedAt: opts.now,
      department: target.department,
      section: target.name,
      year: target.year,
      secondaryDepartment: secondary.length === 1 ? secondary[0] : null,
      courseId: target.courseId ?? null,
      course: target.courseName ?? null,
      // The new section's batch, not the one they were admitted with.
      ...(target.batch ? { batch: target.batch } : {}),
      // A lab batch belongs to the section it was set in.
      labBatch: "",
      updatedAt: opts.now,
    },
  };
}
