// Pure core of scripts/backfill-timetable-draft-faculty-ids.mjs (no Firebase
// import, so it is unit-tested in src/lib/timetable/draftFacultyIds.test.ts).
//
// Given every timetableDrafts doc of a college, works out which ones need their
// `facultyIds` field stamped or corrected. `facultyIds` is the distinct
// facultyId of every entry in the draft's `slots` array - kept in step with it
// by the draft route going forward; this repairs the drafts written before that
// existed.

/** @param {unknown} slots */
export function facultyIdsOf(slots) {
  const ids = new Set();
  if (Array.isArray(slots)) {
    for (const s of slots) {
      const id = s && typeof s === "object" ? s.facultyId : undefined;
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids].sort();
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * @param {{ id: string; data: Record<string, unknown> }[]} drafts
 * @returns {{ updates: { id: string; facultyIds: string[]; previous: string[] | null }[]; alreadyCorrect: number }}
 */
export function planDraftFacultyIds(drafts) {
  const updates = [];
  let alreadyCorrect = 0;
  for (const d of drafts) {
    const wanted = facultyIdsOf(d.data.slots);
    const have = Array.isArray(d.data.facultyIds) ? d.data.facultyIds.filter((x) => typeof x === "string") : null;
    if (have && sameSet(have, wanted)) { alreadyCorrect++; continue; }
    updates.push({ id: d.id, facultyIds: wanted, previous: have });
  }
  return { updates, alreadyCorrect };
}
