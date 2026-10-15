// Pure core of scripts/audit-subject-duplicates.mjs and scripts/backfill-subject-keys.mjs (no Firebase
// import, so it is unit-tested in src/lib/subjects/subjectKeysScript.test.ts, which also pins these ids to
// the ones src/lib/subjects/subjectKeys.ts computes - they MUST stay identical).
//
// A master subject's identity is (Course Catalog course + regulation + code) and (course + regulation + name).
import { createHash } from "node:crypto";

export const normalizeCode = (c) => String(c ?? "").trim().toUpperCase();
export const normalizeName = (n) => String(n ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const normalizeUniv = (c) => String(c ?? "").replace(/\s+/g, "").toUpperCase();

const part = (v) => String(v ?? "").trim().toLowerCase();
const sha = (raw) => createHash("sha256").update(raw).digest("hex").slice(0, 40);
export const codeKeyId = (scope, regulation, code) => sha([scope, regulation, normalizeCode(code)].map(part).join("|"));
export const nameKeyId = (scope, regulation, name) => sha(["name", scope, regulation, normalizeName(name)].map(part).join("|"));

/**
 * @param {{ id: string; data: Record<string, any> }[]} subjects  every doc of colleges/{id}/subjects
 * @param {{ id: string; data: Record<string, any> }[]} courses   every doc of colleges/{id}/courses
 * @param {Map<string, number>} [usage]  subjectId -> number of semester assignments / teaching assignments pointing at it
 */
export function planSubjectKeys(subjects, courses, usage = new Map()) {
  const catalogOf = new Map(courses.map((c) => [c.id, c.data.catalogId || c.id]));
  const dataOf = new Map(subjects.map((s) => [s.id, s.data]));
  const legacy = [];     // no courseId: the old semester-scoped shape - left alone
  const unscoped = [];   // master but no regulation / unknown course - cannot be keyed
  const groups = new Map(); // `${scope}|${regulation}` -> members
  for (const s of subjects) {
    const d = s.data;
    if (!d.courseId) { legacy.push(s.id); continue; }
    const regulation = String(d.regulation ?? "").trim();
    const scope = d.catalogId || catalogOf.get(d.courseId);
    if (!regulation || !scope) { unscoped.push({ id: s.id, code: d.code ?? "", reason: !regulation ? "no regulation" : "course not found" }); continue; }
    const key = `${scope}|${regulation}`;
    const list = groups.get(key) ?? [];
    list.push({ id: s.id, scope, regulation, code: normalizeCode(d.code), rawCode: d.code, name: d.name ?? "", nameKey: normalizeName(d.name), courseId: d.courseId, used: usage.get(s.id) ?? 0, isActive: d.isActive !== false });
    groups.set(key, list);
  }

  const clashes = [];  // { scope, regulation, field, value, members }
  const keys = [];     // locks to write: { id, field, subjectId }
  const subjectFixes = []; // { id, set: { catalogId?, nameKey?, code? } }
  for (const members of groups.values()) {
    const byField = { code: new Map(), name: new Map() };
    for (const m of members) {
      const add = (map, v) => { if (v) map.set(v, [...(map.get(v) ?? []), m]); };
      add(byField.code, m.code); add(byField.name, m.nameKey);
    }
    const clashing = new Set();
    for (const [field, map] of Object.entries(byField)) {
      for (const [value, list] of map) {
        if (list.length < 2) continue;
        clashes.push({ scope: list[0].scope, regulation: list[0].regulation, field, value, members: list });
        list.forEach((m) => clashing.add(m.id));
      }
    }
    for (const m of members) {
      if (clashing.has(m.id)) continue; // a human decides these first - never keyed, never touched
      if (m.code) keys.push({ id: codeKeyId(m.scope, m.regulation, m.code), field: "code", subjectId: m.id });
      if (m.nameKey) keys.push({ id: nameKeyId(m.scope, m.regulation, m.name), field: "name", subjectId: m.id });
      const set = {};
      const d = dataOf.get(m.id);
      if (d.catalogId !== m.scope && catalogOf.get(m.courseId) === m.scope && courses.some((c) => c.id === m.courseId && c.data.catalogId)) set.catalogId = m.scope;
      if (d.nameKey !== m.nameKey) set.nameKey = m.nameKey;
      if (m.rawCode !== m.code && m.code) set.code = m.code;
      if (Object.keys(set).length) subjectFixes.push({ id: m.id, set });
    }
  }
  return { legacy, unscoped, clashes, keys, subjectFixes };
}
