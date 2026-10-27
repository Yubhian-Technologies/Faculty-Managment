import type { MidBankSection } from "@/types/midQuestionBank";

// Who teaches a subject where, for one deadline, and which sections a faculty
// member may put in a bank: the subject's sections in that branch, at least
// one of their own, and none already in another bank.

export interface TeachingRow {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  branch: string; // the section's department
  sectionId: string;
  sectionName: string;
  facultyId: string;
  facultyName: string;
}

export const branchKey = (branch: string) => branch.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "branch";
export const outcomesIdFor = (subjectId: string, branch: string) => `${subjectId}__${branchKey(branch)}`;
export const bankIdFor = (deadlineId: string, subjectId: string, branch: string, ownerFacultyId: string) =>
  `${deadlineId}__${subjectId}__${branchKey(branch)}__${ownerFacultyId}`;
export const claimIdFor = (deadlineId: string, subjectId: string, sectionId: string) => `${deadlineId}__${subjectId}__${sectionId}`;

/** The sections of one subject in one branch, with who teaches each (a section can have more than one). */
export function sectionsOf(rows: TeachingRow[], subjectId: string, branch: string): MidBankSection[] {
  const by = new Map<string, MidBankSection>();
  for (const r of rows) {
    if (r.subjectId !== subjectId || r.branch !== branch) continue;
    const s = by.get(r.sectionId) ?? { sectionId: r.sectionId, sectionName: r.sectionName, facultyIds: [], facultyNames: [] };
    if (!s.facultyIds.includes(r.facultyId)) { s.facultyIds.push(r.facultyId); s.facultyNames.push(r.facultyName); }
    by.set(r.sectionId, s);
  }
  return [...by.values()].sort((a, b) => a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true }));
}

/**
 * The sections a faculty member picked for a bank, checked: each must be one of
 * the subject's sections in the branch, at least one their own, none held by
 * another bank (`claims`: sectionId -> who holds it, for sections in other banks).
 */
export function checkSectionPick(
  available: MidBankSection[],
  picked: string[],
  me: string,
  claims: Map<string, string>
): { sections: MidBankSection[]; error: string } {
  const ids = [...new Set(picked)];
  if (ids.length === 0) return { sections: [], error: "Pick at least one section" };
  const byId = new Map(available.map((s) => [s.sectionId, s]));
  const sections: MidBankSection[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) return { sections: [], error: "A picked section doesn't have this subject in this branch" };
    const holder = claims.get(id);
    if (holder) return { sections: [], error: `Section ${s.sectionName} is already in ${holder}'s question bank` };
    sections.push(s);
  }
  if (!sections.some((s) => s.facultyIds.includes(me))) return { sections: [], error: "Include at least one section you teach" };
  return { sections: sections.sort((a, b) => a.sectionName.localeCompare(b.sectionName, undefined, { numeric: true })), error: "" };
}
