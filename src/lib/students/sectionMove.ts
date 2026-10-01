import { sectionFeedsTarget } from "@/lib/sections/sectionLabel";
import type { Section, StudentRecord } from "@/types";

// The rules for putting ONE student into ONE section, shared by the manual
// bulk Move / Assign action (students/bulk-move). Pure: it decides, the route
// writes. A student that fails any rule is reported and left exactly as they
// are - nothing here ever half-moves someone.
//
// Deliberately stricter than the single-student PATCH move, because a bulk
// action multiplies a wrong click: the section must be one that actually feeds
// the student's own (or pre-registered) branch, and for the student's own year
// - moving between years is Promotion's job, not this action's.

type MovableStudent = Pick<
  StudentRecord,
  "department" | "secondaryDepartment" | "section" | "year" | "courseId" | "rollNumber" | "name"
>;
type TargetSection = Pick<Section, "name" | "year" | "department" | "courseId" | "courseName" | "secondaryDepartments">;

export type SectionMovePlan =
  | {
      ok: true;
      /** Fields to write on the student doc (without updatedAt). */
      update: Record<string, unknown>;
      /** Department to record on the department-history entry. */
      historyDepartment: string;
    }
  | { ok: false; reason: string };

/**
 * The sections that could take EVERY one of `students`: all in one year, and
 * each section feeding each student's own (or pre-registered) branch. Used by
 * the Students page to keep impossible choices off the bulk-move list; the
 * server re-checks every student regardless (planSectionMove).
 */
export function sectionsAcceptingAll<S extends Pick<Section, "year" | "department" | "secondaryDepartments">>(
  sections: S[],
  students: Pick<StudentRecord, "year" | "department" | "secondaryDepartment">[]
): S[] {
  if (students.length === 0) return [];
  const year = students[0].year;
  if (students.some((s) => s.year !== year)) return [];
  return sections.filter(
    (sec) => sec.year === year && students.every((s) => sectionFeedsTarget(sec, s.department, s.secondaryDepartment ?? ""))
  );
}

export interface PlanSectionMoveOptions {
  /** True for the college's common / freshman department (or one of its sub-departments). */
  isSharedDept: (name: string) => boolean;
  /** Lower-cased roll numbers of students already sitting in the target section. */
  targetRolls?: ReadonlySet<string>;
}

export function planSectionMove(
  student: MovableStudent,
  target: TargetSection,
  opts: PlanSectionMoveOptions
): SectionMovePlan {
  if (student.year !== target.year) {
    return { ok: false, reason: `Year ${student.year} student can't go into a Year ${target.year} section - use Promotion to change year` };
  }

  if (!sectionFeedsTarget(target, student.department, student.secondaryDepartment ?? "")) {
    const branch = student.secondaryDepartment || student.department;
    return { ok: false, reason: `Section ${target.name} (${target.department}) doesn't belong to ${branch}` };
  }

  const sameSection = student.section === target.name
    && (student.courseId ?? "") === (target.courseId ?? "")
    && (student.department === target.department || !!student.secondaryDepartment);
  if (sameSection) return { ok: false, reason: `Already in section ${target.name}` };

  // Cross-listing, same rule as the single move: one listed department is used
  // as-is; several need the student's own pre-registered branch to pick one.
  const listed = target.secondaryDepartments ?? [];
  let secondaryDept = "";
  if (listed.length === 1) {
    secondaryDept = listed[0];
  } else if (listed.length > 1) {
    const own = (student.secondaryDepartment ?? "").trim().toLowerCase();
    const match = listed.find((d) => d.trim().toLowerCase() === own);
    if (!match) return { ok: false, reason: `Section ${target.name} is cross-listed to several departments (${listed.join(", ")}) and this student's isn't one of them` };
    secondaryDept = match;
  }

  const roll = (student.rollNumber ?? "").trim().toLowerCase();
  if (roll && opts.targetRolls?.has(roll)) {
    return { ok: false, reason: `Roll number ${student.rollNumber} already exists in section ${target.name}` };
  }

  // A shared-first-year student keeps their common department for the whole
  // first year whichever branch's section they sit in (only Promotion moves
  // them into the branch) - see students/[id] PATCH, which this mirrors.
  const staysInSharedDept = opts.isSharedDept(student.department) && target.department !== student.department;
  const placement = {
    section: target.name,
    year: target.year,
    courseId: target.courseId,
    course: target.courseName ?? null,
  };
  return staysInSharedDept
    ? { ok: true, update: placement, historyDepartment: student.department }
    : {
        ok: true,
        update: { department: target.department, secondaryDepartment: secondaryDept || null, ...placement },
        historyDepartment: target.department,
      };
}
