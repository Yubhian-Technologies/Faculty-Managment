import type { Department } from "@/types";
import { managedCoreCandidates, rollupDepartmentNames, type TreeDepartment } from "@/lib/departments/departmentTree";

/**
 * Two small rules the Teaching Assignments screens share, both read from the
 * department configuration and nothing else.
 */

type SectionDept = TreeDepartment & Pick<Department, "name">;

/**
 * The department names whose sections a Sub-department filter pick stands for:
 *
 *  - the pick itself;
 *  - for a parent that holds nothing itself (a container - see departmentTree),
 *    every sub-department too, and every branch those sub-departments manage;
 *  - for any other department, only what IT manages. A parent that runs its own
 *    sections keeps meaning "its own", exactly as before.
 *
 * A managed branch that holds no sections itself (AI, split into AIML / AIDS)
 * stands for the sub-branches the sections are actually filed under.
 *
 * `sectionDepartmentNames` is where the loaded sections are filed - it is how a
 * parent is recognised as holding nothing. Unknown (empty) leaves only the
 * explicit flag to decide, so nothing is guessed before sections have loaded.
 */
export function departmentPickNames<T extends SectionDept>(
  all: T[],
  pickedName: string,
  sectionDepartmentNames: Iterable<string>
): Set<string> {
  const picked = (pickedName ?? "").trim();
  const names = new Set<string>();
  if (!picked) return names;
  const have = new Set(Array.from(sectionDepartmentNames, (n) => (n ?? "").trim()).filter(Boolean));
  const rolled = rollupDepartmentNames(all, picked, have.size > 0 ? have.has(picked) : undefined);
  for (const n of rolled) names.add(n);
  const dept = all.find((d) => (d.name ?? "").trim() === picked);
  const isContainer = rolled.length > 1;
  for (const n of managedCoreCandidates(all, dept, isContainer)) names.add(n);
  return names;
}

/**
 * Whether a subject mapped to some departments (a Subject Semester Assignment's
 * department ids / names) is one for a section filed under `sectionDepartment`.
 *
 * The exact id / name match is what the screens always did. ADDED to it: a
 * department that groups a branch (`managedDepartments`) stands for that
 * branch's sections, including the sub-branches of a managed branch that holds
 * no sections itself. That is the same relationship the server accepts when a
 * section is staffed (the shared-year manager), so a subject this returns true
 * for can actually be assigned.
 */
export function subjectCoversSection<T extends SectionDept>(
  all: T[],
  mapped: { ids: Set<string>; names: Set<string> },
  sectionDepartment: string
): boolean {
  const section = (sectionDepartment ?? "").trim();
  if (!section) return false;
  const doc = all.find((d) => (d.name ?? "").trim() === section);
  if (doc?.id && mapped.ids.has(doc.id)) return true;
  if (mapped.names.has(section)) return true;
  return mappedDepartmentManagesSection(all, mapped, section);
}

/**
 * Only the "added" half of `subjectCoversSection`: some department the subject
 * is mapped to groups the section's branch (`managedDepartments`, including the
 * sub-branches of a managed branch that holds no sections itself). For a screen
 * that already has its own exact-match rule and only wants to add this.
 */
export function mappedDepartmentManagesSection<T extends SectionDept>(
  all: T[],
  mapped: { ids: Set<string>; names: Set<string> },
  sectionDepartment: string
): boolean {
  const section = (sectionDepartment ?? "").trim();
  if (!section) return false;
  for (const assigned of all) {
    const isAssigned = (!!assigned.id && mapped.ids.has(assigned.id)) || mapped.names.has((assigned.name ?? "").trim());
    if (!isAssigned) continue;
    if (managedCoreCandidates(all, assigned, false).includes(section)) return true;
  }
  return false;
}
