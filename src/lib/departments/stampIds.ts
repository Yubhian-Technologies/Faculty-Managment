// Phase-1 dual-write helper: every write path that stores a department NAME
// also stores the matching department ID next to it, derived from the same
// name through the college's department index (resolve.ts). Additive - it never
// removes or rewrites the name fields, and it never invents an id: a value that
// does not resolve (blank / unknown / ambiguous) is simply left without one.
//
// Pairs mirror scripts/lib/departmentRefs.mjs DEPARTMENT_REF_FIELDS.

import { buildDepartmentIndex, resolveDepartmentId, type DepartmentIndex } from "./resolve";

const SCALAR_PAIRS: [string, string][] = [
  ["department", "departmentId"],
  ["departmentName", "departmentId"],
  ["secondaryDepartment", "secondaryDepartmentId"],
  ["requestingDepartment", "requestingDepartmentId"],
  ["targetDepartmentName", "targetDepartmentId"],
];

const ARRAY_PAIRS: [string, string][] = [
  ["secondaryDepartments", "secondaryDepartmentIds"],
  ["departments", "departmentIds"],
  ["managedDepartments", "managedDepartmentIds"],
];

export async function loadDepartmentIndex(
  db: FirebaseFirestore.Firestore,
  collegeId: string
): Promise<DepartmentIndex> {
  const snap = await db.collection("colleges").doc(collegeId).collection("departments").select("name", "code").get();
  return buildDepartmentIndex(
    snap.docs.map((d) => ({ id: d.id, ...(d.data() as { name?: string; code?: string }) }))
  );
}

/**
 * Returns `data` plus the id companion of every department-name field it
 * contains. An id already present on `data` (e.g. a caller that resolved it
 * itself) is kept as-is. Arrays get an id array only when EVERY element
 * resolves (a partial id array would silently drop entries once reads switch
 * to ids).
 */
export function stampDepartmentIds<T extends Record<string, unknown>>(
  data: T,
  index: DepartmentIndex
): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [nameField, idField] of SCALAR_PAIRS) {
    const raw = data[nameField];
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (typeof data[idField] === "string" && data[idField]) continue;
    const r = resolveDepartmentId(index, raw);
    if (r.ok) out[idField] = r.id;
  }
  for (const [nameField, idField] of ARRAY_PAIRS) {
    const raw = data[nameField];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    if (Array.isArray(data[idField])) continue;
    const results = raw.map((v) => resolveDepartmentId(index, typeof v === "string" ? v : ""));
    if (results.every((r) => r.ok)) out[idField] = results.map((r) => (r as { ok: true; id: string }).id);
  }
  return out as T & Record<string, unknown>;
}
