// Section-scoped writes for `academicProfile`.
//
// The old save path sent the WHOLE academicProfile object, and the PATCH routes
// replaced the stored one with it. Each edit page loads a snapshot, so saving
// one tab wrote that (possibly stale) snapshot of every OTHER tab back over
// whatever a second editor - the HOD, or the faculty member on their own
// profile - had saved in the meantime.
//
// Instead, an edit page sends only what it actually changed:
//   { set: { <academicProfile key>: <new value> }, remove: [<key>, ...] }
// computed by diffAcademicProfile(original, next), and the routes write those
// keys with Firestore dot-paths (`academicProfile.<key>`), leaving every other
// key of the stored profile exactly as it is. Two editors touching DIFFERENT
// tabs can no longer overwrite each other.
//
// Old-shaped (un-migrated) docs keep working: incoming values are lifted to the
// current key names, and the old-named twin of any key being written is deleted
// so a doc never holds both (see academicProfileFirestoreUpdates).

import { ACADEMIC_PROFILE_ROOT_RENAMES, ROLE_FIELD_TO_LIST } from "./fieldRenames";
import { normalizeAcademicProfile } from "./academicProfileCompat";

type Obj = Record<string, unknown>;

export interface AcademicProfileChanges {
  set: Obj;
  remove: string[];
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortDeep(v[k])]));
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

// What changed between the profile as loaded and the profile as edited.
// Only top-level academicProfile keys are compared - a changed nested value
// (e.g. one degree's Place) makes its whole top-level key part of `set`.
export function diffAcademicProfile(original: unknown, next: unknown): AcademicProfileChanges {
  const o = isObj(original) ? original : {};
  const n = isObj(next) ? next : {};
  const set: Obj = {};
  const remove: string[] = [];
  for (const key of Object.keys(n)) {
    if (n[key] === undefined) continue;
    if (!(key in o) || !sameValue(o[key], n[key])) set[key] = n[key];
  }
  for (const key of Object.keys(o)) {
    if (o[key] !== undefined && (!(key in n) || n[key] === undefined)) remove.push(key);
  }
  return { set, remove };
}

export function isEmptyChanges(c: AcademicProfileChanges): boolean {
  return Object.keys(c.set).length === 0 && c.remove.length === 0;
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

// Validates an untrusted request body value. Returns null when malformed. Keys
// must be plain identifiers - never a dotted path - so a caller can only ever
// address top-level academicProfile keys.
export function parseAcademicProfileChanges(raw: unknown): AcademicProfileChanges | null {
  if (!isObj(raw)) return null;
  const set = raw.set === undefined ? {} : raw.set;
  const remove = raw.remove === undefined ? [] : raw.remove;
  if (!isObj(set) || !Array.isArray(remove)) return null;
  if (!Object.keys(set).every((k) => KEY_PATTERN.test(k))) return null;
  if (!remove.every((k): k is string => typeof k === "string" && KEY_PATTERN.test(k))) return null;
  return { set, remove };
}

// Drops keys the caller is not allowed to write (used by the self-service route
// for the College-Office-owned / R&D-verified keys).
export function withoutAcademicProfileKeys(changes: AcademicProfileChanges, blocked: readonly string[]): AcademicProfileChanges {
  const set: Obj = {};
  for (const [k, v] of Object.entries(changes.set)) if (!blocked.includes(k)) set[k] = v;
  return { set, remove: changes.remove.filter((k) => !blocked.includes(k)) };
}

// Lifts any legacy key names an older client may still send (in `set` and in
// `remove`) to the current ones.
export function normalizeAcademicProfileChanges(changes: AcademicProfileChanges): AcademicProfileChanges {
  return {
    set: normalizeAcademicProfile(changes.set) as Obj,
    remove: Array.from(new Set(changes.remove.map((k) => ACADEMIC_PROFILE_ROOT_RENAMES[k] ?? k))),
  };
}

// The profile as it will look after the change is applied - used to recompute
// derived values (Total Years of Experience) and to sync co-conductors.
export function applyAcademicProfileChanges(existing: unknown, changes: AcademicProfileChanges): Obj {
  const c = normalizeAcademicProfileChanges(changes);
  const base: Obj = { ...(isObj(existing) ? (normalizeAcademicProfile(existing) as Obj) : {}) };
  for (const k of c.remove) delete base[k];
  Object.assign(base, c.set);
  return base;
}

// The Firestore update() fragment: one dot-path per changed key, nothing else.
// `existingRaw` is the STORED academicProfile (possibly still old-shaped) so the
// old-named twin of any key being written can be deleted alongside it.
export function academicProfileFirestoreUpdates(existingRaw: unknown, changes: AcademicProfileChanges, deleteSentinel: unknown): Obj {
  const c = normalizeAcademicProfileChanges(changes);
  const updates: Obj = {};
  for (const [k, v] of Object.entries(c.set)) updates[`academicProfile.${k}`] = v;
  for (const k of c.remove) updates[`academicProfile.${k}`] = deleteSentinel;

  const raw = isObj(existingRaw) ? existingRaw : {};
  const touched = new Set([...Object.keys(c.set), ...c.remove]);
  for (const [oldKey, newKey] of Object.entries(ACADEMIC_PROFILE_ROOT_RENAMES)) {
    if (touched.has(newKey) && oldKey in raw && !(`academicProfile.${oldKey}` in updates)) {
      updates[`academicProfile.${oldKey}`] = deleteSentinel;
    }
  }
  // Roles/Responsibilities now live on each experience entry. Once an entry list being
  // written carries a legacy shared root field's text, that root field (and its older
  // twins) is deleted alongside it - but only then, so text that no entry holds (an
  // orphan, or a stale client's write that dropped it) is never removed.
  for (const { role, list } of ROLE_FIELD_TO_LIST) {
    const written = c.set[list];
    if (!touched.has(list) || !Array.isArray(written)) continue;
    const carried = new Set(written.map((e) => (isObj(e) && typeof e.rolesResponsibilities === "string" ? e.rolesResponsibilities.trim() : "")).filter(Boolean));
    const twins: { path: string; text: unknown }[] = [{ path: role, text: raw[role] }];
    if (role === "teachingRolesResponsibilities") {
      // Skipped when teachingAssignment itself is being rewritten - a parent path and a
      // child path cannot be updated in the same call, and the rewrite already drops it.
      if (!touched.has("teachingAssignment") && isObj(raw.teachingAssignment)) {
        twins.push({ path: "teachingAssignment.primaryTeachingRole", text: raw.teachingAssignment.primaryTeachingRole });
      }
    } else {
      twins.push({ path: role === "industryRolesResponsibilities" ? "primaryIndustryRole" : "primaryResearchRole", text: raw[role === "industryRolesResponsibilities" ? "primaryIndustryRole" : "primaryResearchRole"] });
    }
    for (const { path, text } of twins) {
      if (typeof text === "string" && text.trim() !== "" && carried.has(text.trim()) && !touched.has(path) && !(`academicProfile.${path}` in updates)) {
        updates[`academicProfile.${path}`] = deleteSentinel;
      }
    }
  }
  return updates;
}

// Whether this change touches the Professional Development training list, i.e.
// whether co-conductor copies on other faculty records need re-syncing.
export function touchesTrainingEntries(changes: AcademicProfileChanges): boolean {
  const c = normalizeAcademicProfileChanges(changes);
  return "fdpsWorkshopsMoocsCertifications" in c.set || c.remove.includes("fdpsWorkshopsMoocsCertifications");
}
