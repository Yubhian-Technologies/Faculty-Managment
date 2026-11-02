// What a student may see of their own Student Mentoring Record. The record is the mentor's
// working document, so a student reads it (never writes it) minus the parts the booklet itself
// marks "visible to the mentor and HOD only": referrals, the health record, the per-semester
// remarks and the mentoring notes (which are not record entries and are never sent at all).

export const STUDENT_HIDDEN_ENTRY_SECTIONS: ReadonlySet<string> = new Set(["escalations", "healthRecord"]);

/** Hidden from the STUDENT only - the Principal / Vice Principal's read-only view still shows them. */
export const SELF_HIDDEN_ENTRY_SECTIONS: ReadonlySet<string> = new Set(["disciplinary"]);

export function visibleToStudent<T extends { section: string }>(entries: T[], opts: { self?: boolean } = {}): T[] {
  return entries.filter((e) => !STUDENT_HIDDEN_ENTRY_SECTIONS.has(e.section) && !(opts.self && SELF_HIDDEN_ENTRY_SECTIONS.has(e.section)));
}
