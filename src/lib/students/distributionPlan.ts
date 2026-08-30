// Pure (Firestore-free) planning logic for student section distribution -
// deliberately separated from the Firestore reads/writes in
// distribute/route.ts and distribute-cohort/route.ts so the actual
// assignment math is unit-testable without a database, and so a future
// preview UI can call the exact same function a commit uses (see
// buildDistributionPlan's own doc-comment).
import { evenSplit, compareStudentsBySurname, compareSectionsByName } from "./evenSplit";

export interface DistributionStudent {
  id: string;
  name?: string;
  section: string;
}

export interface DistributionSection {
  id: string;
  name: string;
}

export interface DistributionMove {
  studentId: string;
  studentName: string;
  fromSectionName: string;
  toSectionId: string;
  toSectionName: string;
}

export interface DistributionPlanSection {
  sectionId: string;
  sectionName: string;
  studentIds: string[];
}

export interface DistributionPlan {
  perSection: DistributionPlanSection[];
  // Only students whose section actually changes - a student already sitting
  // in their computed target section produces no entry here, which is what
  // makes applying a plan idempotent: writing it twice in a row is a no-op
  // the second time.
  moves: DistributionMove[];
  totalStudents: number;
  movedCount: number;
}

// Flags empty/whitespace-only names before they can silently enter sorting
// (an empty surnameKey would otherwise sort first with no indication
// anything's wrong). Callers must reject the run rather than proceed when
// `invalid` is non-empty.
export function validateStudentNames<T extends { id: string; name?: string }>(
  students: T[]
): { valid: T[]; invalid: { id: string; name?: string }[] } {
  const valid: T[] = [];
  const invalid: { id: string; name?: string }[] = [];
  for (const s of students) {
    if ((s.name ?? "").trim().length === 0) invalid.push({ id: s.id, name: s.name });
    else valid.push(s);
  }
  return { valid, invalid };
}

// Sorts students by surname (surnameKey -> full name -> id, see
// compareStudentsBySurname) and sections by natural name order (see
// compareSectionsByName - NOT the order the caller passed them in), then
// deals the sorted students out into contiguous alphabetical blocks via
// evenSplit, one block per section in that sorted order.
//
// Callers should already have sorted `sections` themselves (this re-sorts
// defensively so the plan is correct even if they didn't), and should have
// already narrowed `students` to the eligible cohort (unassigned + currently
// in one of these sections) - this function has no opinion on eligibility,
// only on ordering and splitting.
export function buildDistributionPlan(
  students: DistributionStudent[],
  sections: DistributionSection[]
): DistributionPlan {
  const sortedStudents = [...students].sort(compareStudentsBySurname);
  const sortedSections = [...sections].sort(compareSectionsByName);
  const slices = evenSplit(sortedStudents, sortedSections.length);

  const perSection: DistributionPlanSection[] = [];
  const moves: DistributionMove[] = [];

  for (let i = 0; i < sortedSections.length; i++) {
    const section = sortedSections[i];
    const slice = slices[i] ?? [];
    perSection.push({ sectionId: section.id, sectionName: section.name, studentIds: slice.map((s) => s.id) });
    for (const student of slice) {
      if (student.section === section.name) continue;
      moves.push({
        studentId: student.id,
        studentName: student.name ?? "",
        fromSectionName: student.section,
        toSectionId: section.id,
        toSectionName: section.name,
      });
    }
  }

  return { perSection, moves, totalStudents: sortedStudents.length, movedCount: moves.length };
}

// Re-checks the invariants buildDistributionPlan is supposed to guarantee by
// construction - every eligible student assigned to exactly one section, no
// duplicates, every target section is one of the selected ones, and section
// sizes differ by at most one. Thrown, not returned, since a violation here
// means the plan itself is broken and nothing should be written.
export function validateDistributionPlan(
  plan: DistributionPlan,
  cohortIds: Set<string>,
  sectionIds: Set<string>
): void {
  const assigned = plan.perSection.flatMap((s) => s.studentIds);
  if (assigned.length !== cohortIds.size) {
    throw new Error(`Distribution plan assigns ${assigned.length} students but cohort has ${cohortIds.size}`);
  }
  const seen = new Set<string>();
  for (const id of assigned) {
    if (seen.has(id)) throw new Error(`Distribution plan assigns student ${id} more than once`);
    seen.add(id);
    if (!cohortIds.has(id)) throw new Error(`Distribution plan assigns student ${id} who is not in the cohort`);
  }
  for (const s of plan.perSection) {
    if (!sectionIds.has(s.sectionId)) throw new Error(`Distribution plan targets section ${s.sectionId} which was not selected`);
  }
  const sizes = plan.perSection.map((s) => s.studentIds.length);
  if (sizes.length > 0 && Math.max(...sizes) - Math.min(...sizes) > 1) {
    throw new Error("Distribution plan is not balanced - section sizes differ by more than one student");
  }
}
