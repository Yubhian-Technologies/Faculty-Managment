/**
 * Shared by scripts/audit-department-refs.mjs, backup-department-data.mjs,
 * migrate-department-ids.mjs and rollback-department-ids.mjs.
 *
 * - DEPARTMENT_REF_FIELDS: the catalog of every place a department is stored by
 *   NAME. Mirrors (and must stay a superset of) renameCascade.ts's field list.
 *   The audit's discovery pass reports any `*department*` string field that is
 *   NOT in this catalog, so drift is caught instead of silently missed.
 * - normalize/resolve: a .mjs mirror of src/lib/departments/resolve.ts (scripts
 *   cannot import the TS module). Keep the two in sync - resolve.test.ts pins
 *   the TS behaviour these functions copy.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function initDb() {
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }
  return getFirestore();
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out.values[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out.values[a.slice(2)] = argv[++i];
    else out.flags.add(a.slice(2));
  }
  return out;
}

// kind: scalar   - a string field, id written to `idField`
//       array    - an array of strings, ids written to `idField` (array)
//       nestedScopes - departments.courseScopes[*].secondaryDepartments
// Every entry is relative to colleges/{collegeId}/{collection}.
export const DEPARTMENT_REF_FIELDS = [
  ...[
    "subjects", "facultyMembers", "supportingStaff", "teachingAssignments", "timetableSlots", "timetableDrafts",
    "attendanceRecords", "studentAttendance", "permissionRequests", "onDutyRequests", "leaveRequests",
    "employeeLeaveProfiles", "salaryRecords", "appraisals", "facultyAccountRequests", "emailRequests",
    "vacancyRequests", "hiringBatches", "candidates", "candidateApplications", "offerLetters",
    "appointmentLetters", "budgetRequests", "budgetCycles", "financeBudgets", "financePurchaseClearance",
    "indentRequests", "attendanceCheckInPermissions", "examConfigurations", "internalExamMarks",
    "classWorkRecords", "consultancyProjects", "facultyRequirement", "publications", "sections", "students", "users",
  ].map((collection) => ({ collection, field: "department", idField: "departmentId", kind: "scalar" })),
  { collection: "students", field: "secondaryDepartment", idField: "secondaryDepartmentId", kind: "scalar" },
  { collection: "timetableIncharges", field: "departmentName", idField: "departmentId", kind: "scalar" },
  { collection: "facultyAssignmentRequests", field: "requestingDepartment", idField: "requestingDepartmentId", kind: "scalar" },
  { collection: "facultyAssignmentRequests", field: "targetDepartmentName", idField: "targetDepartmentId", kind: "scalar" },
  { collection: "phdSupervisions", field: "scholarDepartment", idField: "scholarDepartmentId", kind: "scalar" },
  { collection: "sponsoredProjects", field: "piDepartment", idField: "piDepartmentId", kind: "scalar" },
  { collection: "roleSeats", field: "departmentName", idField: "departmentId", kind: "scalar" },
  { collection: "sections", field: "secondaryDepartments", idField: "secondaryDepartmentIds", kind: "array" },
  { collection: "users", field: "departments", idField: "departmentIds", kind: "array" },
  { collection: "departments", field: "secondaryDepartments", idField: "secondaryDepartmentIds", kind: "array" },
  { collection: "departments", field: "managedDepartments", idField: "managedDepartmentIds", kind: "array" },
  { collection: "departments", field: "courseScopes", idField: "secondaryDepartmentIds", kind: "nestedScopes" },
];

// Name fields that hold a department by design but are intentionally NOT
// migrated (history / non-reference). The discovery pass ignores these.
export const DISCOVERY_IGNORE = new Set([
  "auditLogs", "migrationLedger", "departmentKeys",
]);
// Keys that are already the id/hierarchy fields themselves, not name references.
export const DISCOVERY_IGNORE_KEYS = new Set(["departmentId", "parentDepartmentId", "departmentIds", "secondaryDepartmentId", "secondaryDepartmentIds", "managedDepartmentIds"]);

// ---- mirror of src/lib/departments/resolve.ts -------------------------------
export const normName = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const normCode = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
export const canonName = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

export function buildIndex(depts) {
  const byId = new Map();
  const byName = new Map();
  const byCode = new Map();
  const push = (m, k, d) => { if (!k) return; (m.get(k) ?? m.set(k, []).get(k)).push(d); };
  for (const d of depts) {
    byId.set(d.id, d);
    push(byName, normName(d.name), d);
    push(byCode, normCode(d.code), d);
  }
  return { byId, byName, byCode };
}

/**
 * Resolution order: exact id -> normalised name -> code -> per-college mapping
 * (stale/legacy strings). `mapping` is { "<stale text>": "<dept id | code | current name>" }.
 * Returns { ok, id, name, via } or { ok:false, reason: blank|none|ambiguous }.
 */
export function resolveValue(index, raw, mapping = new Map()) {
  const text = String(raw ?? "");
  if (!text.trim()) return { ok: false, reason: "blank" };
  const direct = index.byId.get(text.trim());
  if (direct) return { ok: true, id: direct.id, name: direct.name ?? "", via: "id" };

  const hits = new Map();
  for (const d of index.byName.get(normName(text)) ?? []) hits.set(d.id, { d, via: "name" });
  for (const d of index.byCode.get(normCode(text)) ?? []) if (!hits.has(d.id)) hits.set(d.id, { d, via: "code" });
  if (hits.size > 1) return { ok: false, reason: "ambiguous", candidates: [...hits.keys()] };
  if (hits.size === 1) {
    const { d, via } = [...hits.values()][0];
    return { ok: true, id: d.id, name: d.name ?? "", via };
  }

  const mapped = mapping.get(normName(text));
  if (mapped) {
    const viaMap = resolveValue(index, mapped, new Map());
    if (viaMap.ok) return { ...viaMap, via: "mapping" };
  }
  return { ok: false, reason: "none" };
}

export function loadMapping(collegeId, dir = path.resolve(import.meta.dirname, "..", "dept-mappings")) {
  const file = path.join(dir, `${collegeId}.json`);
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_")) m.set(normName(k), String(v));
  return m;
}

// ---- helpers ----------------------------------------------------------------
export async function loadDepartments(collegeRef) {
  const snap = await collegeRef.collection("departments").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Streams every doc of a collection in id-ordered pages (no cap). */
export async function* streamDocs(collRef, pageSize = 500) {
  let last = null;
  for (;;) {
    let q = collRef.orderBy("__name__").limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const doc of snap.docs) yield doc;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) return;
  }
}

export function timestampDir(base) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(base, stamp);
}

export const DEFAULT_OUT_BASE = path.resolve(import.meta.dirname, "..", "..", "..", "department-migration");

export function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(file, rows, headers) {
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}
