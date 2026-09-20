// A department rename (college/departments PATCH changing `name`) used to
// write only the department doc itself - every other collection that stores
// a copy of the department name as free text kept the OLD name forever,
// silently breaking every exact-string scope/query built on top of it. This
// module refreshes those copies, called synchronously from departments/route.ts
// PATCH right after the rename itself commits.
//
// ROLE AFTER THE departmentId MIGRATION: `departmentId` is the join key, so a
// rename no longer breaks scope/queries - this cascade only refreshes the
// DISPLAY-NAME copy stored beside each id. It now (1) covers every collection in
// refFields.ts (the old hand-kept list missed ~20), (2) matches by id as well as
// by old name (so a doc the name pass would miss - e.g. one whose stored name
// had drifted - is still refreshed), and (3) stamps the id on any doc it finds
// by old name. Failure is cosmetic, never corrupting, and a retry is idempotent.
//
// This project has no cron/scheduled-job infrastructure (see
// src/lib/attendance/closeMissedCheckouts.ts's own doc-comment for the same
// finding) - so, like every other "keep denormalized data in sync" fix in
// this codebase (Subject.hoursPerWeek's cascade in subjects/[id]/route.ts,
// the HOD hodUid/hodName self-heal in departments/route.ts GET), this runs
// inline, chunked, synchronously in the request rather than as a background
// job. Every write is idempotent, so a doc already fixed by an earlier
// attempt simply drops out of a retry's queries - safe to call again after a
// timeout/partial failure without double-writing or duplicating anything.
//
// Department renames specifically are a Tier-1 concern (unlike a faculty/
// subject rename, which deliberately does NOT touch historical snapshots): the
// requirement is explicit - nowhere may keep displaying the old name,
// including historical reporting collections.

import { DEPARTMENT_REF_FIELDS, type DepartmentRefField } from "./refFields";

export interface DepartmentRenameCascadeResult {
  completedSteps: string[];
  failedStep?: string;
  error?: string;
}

type Db = FirebaseFirestore.Firestore;
type PendingUpdate = { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> };

async function commitInChunks(db: Db, updates: PendingUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 400)) batch.update(u.ref, u.patch);
    await batch.commit();
  }
}

// `field == oldName -> newName` (and stamp the id), plus `idField == id` docs
// whose stored name differs from newName. A doc reached by both is updated once.
async function refreshScalar(
  db: Db,
  coll: FirebaseFirestore.CollectionReference,
  ref: DepartmentRefField,
  oldName: string,
  newName: string,
  departmentId?: string
): Promise<void> {
  const now = new Date();
  const updates = new Map<string, PendingUpdate>();
  const byName = await coll.where(ref.field, "==", oldName).get();
  for (const d of byName.docs) {
    updates.set(d.id, {
      ref: d.ref,
      patch: { [ref.field]: newName, ...(departmentId ? { [ref.idField]: departmentId } : {}), updatedAt: now },
    });
  }
  if (departmentId) {
    const byId = await coll.where(ref.idField, "==", departmentId).get();
    for (const d of byId.docs) {
      if (updates.has(d.id)) continue;
      if ((d.data() as Record<string, unknown>)[ref.field] !== newName) {
        updates.set(d.id, { ref: d.ref, patch: { [ref.field]: newName, updatedAt: now } });
      }
    }
  }
  await commitInChunks(db, [...updates.values()]);
}

// String[] name field with an index-aligned id array. An old-name match rewrites
// that element; an id match rewrites the element at the id's position.
async function refreshArray(
  db: Db,
  coll: FirebaseFirestore.CollectionReference,
  ref: DepartmentRefField,
  oldName: string,
  newName: string,
  departmentId?: string
): Promise<void> {
  const now = new Date();
  const updates = new Map<string, PendingUpdate>();
  const byName = await coll.where(ref.field, "array-contains", oldName).get();
  for (const d of byName.docs) {
    const current = ((d.data() as Record<string, unknown>)[ref.field] as string[] | undefined) ?? [];
    updates.set(d.id, { ref: d.ref, patch: { [ref.field]: current.map((v) => (v === oldName ? newName : v)), updatedAt: now } });
  }
  if (departmentId) {
    const byId = await coll.where(ref.idField, "array-contains", departmentId).get();
    for (const d of byId.docs) {
      if (updates.has(d.id)) continue;
      const data = d.data() as Record<string, unknown>;
      const names = [...((data[ref.field] as string[] | undefined) ?? [])];
      const ids = (data[ref.idField] as string[] | undefined) ?? [];
      let changed = false;
      ids.forEach((id, i) => {
        if (id === departmentId && names[i] !== undefined && names[i] !== newName) {
          names[i] = newName;
          changed = true;
        }
      });
      if (changed) updates.set(d.id, { ref: d.ref, patch: { [ref.field]: names, updatedAt: now } });
    }
  }
  await commitInChunks(db, [...updates.values()]);
}

export async function cascadeDepartmentRename(
  db: Db,
  collegeId: string,
  oldName: string,
  newName: string,
  departmentId?: string
): Promise<DepartmentRenameCascadeResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Other departments' own arrays + courseScopes[*] (a nested map, not directly
  // queryable): fetched and patched in code (a handful to a few dozen docs per
  // college). Matches by old name and, when known, by id.
  const patchOtherDepartments = async () => {
    const deptsSnap = await collegeRef.collection("departments").get();
    const now = new Date();
    for (const doc of deptsSnap.docs) {
      const data = doc.data() as {
        secondaryDepartments?: string[];
        secondaryDepartmentIds?: string[];
        managedDepartments?: string[];
        managedDepartmentIds?: string[];
        courseScopes?: Record<string, { secondaryDepartments?: string[]; secondaryDepartmentIds?: string[]; assignedYears?: number[] }>;
      };
      const rewrite = (names: string[] | undefined, ids: string[] | undefined): string[] | null => {
        if (!Array.isArray(names)) return null;
        let changed = false;
        const out = names.map((v, i) => {
          const hit = v === oldName || (departmentId !== undefined && ids?.[i] === departmentId);
          if (hit && v !== newName) {
            changed = true;
            return newName;
          }
          return v;
        });
        return changed ? out : null;
      };
      const patch: Record<string, unknown> = {};
      const sec = rewrite(data.secondaryDepartments, data.secondaryDepartmentIds);
      if (sec) patch.secondaryDepartments = sec;
      const mgd = rewrite(data.managedDepartments, data.managedDepartmentIds);
      if (mgd) patch.managedDepartments = mgd;
      for (const [catalogId, courseScope] of Object.entries(data.courseScopes ?? {})) {
        const r = rewrite(courseScope.secondaryDepartments, courseScope.secondaryDepartmentIds);
        if (r) patch[`courseScopes.${catalogId}.secondaryDepartments`] = r;
      }
      if (Object.keys(patch).length > 0) {
        await doc.ref.update({ ...patch, updatedAt: now });
      }
    }
  };

  const steps: { label: string; run: () => Promise<unknown> }[] = [
    { label: "departments[secondaryDepartments,managedDepartments,courseScopes]", run: patchOtherDepartments },
    ...DEPARTMENT_REF_FIELDS.filter((r) => r.kind !== "nestedScopes" && r.collection !== "departments").map((r) => ({
      label: `${r.collection}.${r.field}`,
      run: () =>
        r.kind === "array"
          ? refreshArray(db, collegeRef.collection(r.collection), r, oldName, newName, departmentId)
          : refreshScalar(db, collegeRef.collection(r.collection), r, oldName, newName, departmentId),
    })),
  ];

  const completedSteps: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
      completedSteps.push(step.label);
    } catch (err) {
      return {
        completedSteps,
        failedStep: step.label,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { completedSteps };
}
