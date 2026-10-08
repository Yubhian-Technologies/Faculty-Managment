import type { Section } from "@/types";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";

export interface SectionParityGap {
  /** Section names present in the source year but absent from the target year. */
  missing: string[];
  /** Section names present in the target year but not in the source year. */
  extra: string[];
}

const norm = (n: string) => n.trim().toLowerCase();

// Promotion moves a cohort into the same course's next-year sections, so both
// years must carry the same set of section names for the department.
export function sectionParityGap(
  sections: Pick<Section, "department" | "courseId" | "year" | "name">[],
  department: string,
  courseId: string,
  sourceYear: number,
  targetYear: number
): SectionParityGap {
  const names = (year: number) => {
    const m = new Map<string, string>();
    for (const s of sections) {
      if (s.courseId === courseId && s.department === department && s.year === year) m.set(norm(s.name), s.name);
    }
    return m;
  };
  const src = names(sourceYear);
  const tgt = names(targetYear);
  return {
    missing: [...src].filter(([k]) => !tgt.has(k)).map(([, v]) => v).sort(),
    extra: [...tgt].filter(([k]) => !src.has(k)).map(([, v]) => v).sort(),
  };
}

/**
 * Says what differs between the two years. This is a NOTE, not a refusal:
 * promotion does not depend on the names lining up, because every student
 * carries an explicit target section (the default target, a per-student pick,
 * or an allotment file). Sections are routinely named for the year they are in
 * - a first year named after the department that teaches it, a renamed branch -
 * and that is not a reason to stop a cohort moving up.
 */
export function describeSectionParityGap(gap: SectionParityGap, sourceYear: number, targetYear: number): string {
  const parts: string[] = [];
  if (gap.missing.length) parts.push(`Section ${gap.missing.join(", ")} has no Year ${targetYear} section of the same name`);
  if (gap.extra.length) parts.push(`Section ${gap.extra.join(", ")} exists only in Year ${targetYear}`);
  return `Year ${sourceYear} and Year ${targetYear} section names differ - ${parts.join("; ")}. Each student still goes to the target picked below.`;
}

/**
 * Whether this section sits in a year that some OTHER department runs for it -
 * a shared first year. Such a cohort does not carry its section name upward,
 * so the parity rule above must not be applied to it.
 *
 * Two shapes of the same arrangement, and both count:
 *
 *  - The section is filed under the FEEDER and names the branch it feeds
 *    (`secondaryDepartments`) - what the parity check used to recognise.
 *  - The section is filed under the BRANCH, and the feeder relationship lives
 *    on the departments instead (Basic Science - Mathematics `manages`
 *    Artificial Intelligence and Data Science for year 1). Every year-1 section
 *    at VISHNU INSTITUTE OF TECHNOLOGY is this shape - "BSM-AIDS-A" is an AIDS
 *    section taught by BS-Maths - and the check saw them as ordinary AIDS
 *    sections, then refused to promote them into AIDS-A/B because the names
 *    differ. They differ by design: the first year is named after the
 *    department that teaches it.
 *
 * Resolved through resolveBranchYearOwner, the same per-year/per-course rule
 * the sections, students and timetable routes already scope by, so this says
 * "shared" for exactly the years a manager actually teaches - year 2 of the
 * same branch is the branch's own again, and keeps the parity rule.
 */
export function isSharedYearSection(
  section: Pick<Section, "department" | "year" | "secondaryDepartments">,
  departments: (DepartmentYearRow & { name?: string })[],
  catalogId: string | undefined
): boolean {
  if ((section.secondaryDepartments?.length ?? 0) > 0) return true;
  const year = Number(section.year);
  if (!Number.isFinite(year)) return false;
  return resolveBranchYearOwner(departments, section.department, year, catalogId) !== section.department;
}
