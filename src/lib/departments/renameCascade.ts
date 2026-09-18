// A department rename (college/departments PATCH changing `name`) used to
// write only the department doc itself - every other collection that stores
// a copy of the department name as free text (see
// scripts/diagnose-department-rename-revert.mjs's DEPT_STRING_COLLECTIONS,
// the canonical list this mirrors) kept the OLD name forever, silently
// breaking every exact-string scope/query built on top of it. This module is
// the real fix: called synchronously from departments/route.ts PATCH right
// after the rename itself commits.
//
// This project has no cron/scheduled-job infrastructure (see
// src/lib/attendance/closeMissedCheckouts.ts's own doc-comment for the same
// finding) - so, like every other "keep denormalized data in sync" fix in
// this codebase (Subject.hoursPerWeek's cascade in subjects/[id]/route.ts,
// the HOD hodUid/hodName self-heal in departments/route.ts GET), this runs
// inline, chunked, synchronously in the request rather than as a background
// job. Every write is idempotent (`field == oldName -> field = newName`), so
// a doc already fixed by an earlier attempt simply drops out of a retry's
// query - safe to call again after a timeout/partial failure without
// double-writing or duplicating anything.
//
// department renames specifically are a Tier-1 concern (unlike a faculty/
// subject rename, which deliberately does NOT touch historical snapshots -
// see the cascades in faculty/[id]/route.ts and subjects/[id]/route.ts): a
// department's identity gates authorization/scope everywhere, and the user
// requirement here is explicit - nowhere may keep pointing at the old name,
// including historical reporting collections.

export interface DepartmentRenameCascadeResult {
  completedSteps: string[];
  failedStep?: string;
  error?: string;
}

type Db = FirebaseFirestore.Firestore;

async function updateScalarField(
  db: Db,
  collectionRef: FirebaseFirestore.CollectionReference,
  field: string,
  oldName: string,
  newName: string
): Promise<number> {
  const snap = await collectionRef.where(field, "==", oldName).get();
  const now = new Date();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const chunk = snap.docs.slice(i, i + 400);
    const batch = db.batch();
    for (const doc of chunk) batch.update(doc.ref, { [field]: newName, updatedAt: now });
    await batch.commit();
  }
  return snap.docs.length;
}

async function updateArrayField(
  db: Db,
  collectionRef: FirebaseFirestore.CollectionReference,
  field: string,
  oldName: string,
  newName: string
): Promise<number> {
  const snap = await collectionRef.where(field, "array-contains", oldName).get();
  const now = new Date();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const chunk = snap.docs.slice(i, i + 400);
    const batch = db.batch();
    for (const doc of chunk) {
      const current = (doc.data()[field] as string[] | undefined) ?? [];
      const updated = current.map((v) => (v === oldName ? newName : v));
      batch.update(doc.ref, { [field]: updated, updatedAt: now });
    }
    await batch.commit();
  }
  return snap.docs.length;
}

// Scalar `department`-style fields shared across most collections - queried
// and rewritten identically, so declared as a plain list rather than a
// repeated function call per collection. Tier 2 (historical/reporting)
// collections are included deliberately - see this file's own doc-comment.
const SCALAR_DEPARTMENT_FIELDS: { collection: string; field: string }[] = [
  { collection: "sections", field: "department" },
  { collection: "subjects", field: "department" },
  { collection: "facultyMembers", field: "department" },
  { collection: "students", field: "department" },
  { collection: "students", field: "secondaryDepartment" },
  { collection: "teachingAssignments", field: "department" },
  { collection: "timetableSlots", field: "department" },
  { collection: "users", field: "department" },
  { collection: "attendanceRecords", field: "department" },
  { collection: "permissionRequests", field: "department" },
  { collection: "onDutyRequests", field: "department" },
  { collection: "leaveRequests", field: "department" },
  { collection: "salaryRecords", field: "department" },
  { collection: "appraisals", field: "department" },
];

export async function cascadeDepartmentRename(
  db: Db,
  collegeId: string,
  oldName: string,
  newName: string
): Promise<DepartmentRenameCascadeResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Other departments' own secondaryDepartments[]/managedDepartments[]
  // arrays and courseScopes[*].secondaryDepartments[] - a nested map, not a
  // directly queryable array field, so fetched and patched in code (the
  // departments collection is small - a handful to a few dozen docs per
  // college, never a scale concern).
  const patchOtherDepartments = async () => {
    const deptsSnap = await collegeRef.collection("departments").get();
    const now = new Date();
    for (const doc of deptsSnap.docs) {
      const data = doc.data() as {
        secondaryDepartments?: string[];
        managedDepartments?: string[];
        courseScopes?: Record<string, { secondaryDepartments?: string[]; assignedYears?: number[] }>;
      };
      const patch: Record<string, unknown> = {};
      for (const field of ["secondaryDepartments", "managedDepartments"] as const) {
        const arr = data[field];
        if (Array.isArray(arr) && arr.includes(oldName)) {
          patch[field] = arr.map((v) => (v === oldName ? newName : v));
        }
      }
      for (const [catalogId, courseScope] of Object.entries(data.courseScopes ?? {})) {
        const arr = courseScope.secondaryDepartments;
        if (Array.isArray(arr) && arr.includes(oldName)) {
          patch[`courseScopes.${catalogId}.secondaryDepartments`] = arr.map((v) => (v === oldName ? newName : v));
        }
      }
      if (Object.keys(patch).length > 0) {
        await doc.ref.update({ ...patch, updatedAt: now });
      }
    }
  };

  const steps: { label: string; run: () => Promise<unknown> }[] = [
    // users.departments[] (array) - the scalar users.department is covered by
    // the generic loop below.
    { label: "users.departments[]", run: () => updateArrayField(db, collegeRef.collection("users"), "departments", oldName, newName) },
    // sections.secondaryDepartments[] (array) - sections.department (scalar)
    // is covered by the generic loop below.
    { label: "sections.secondaryDepartments[]", run: () => updateArrayField(db, collegeRef.collection("sections"), "secondaryDepartments", oldName, newName) },
    { label: "departments[secondaryDepartments,managedDepartments,courseScopes]", run: patchOtherDepartments },
    // Every remaining plain `department`-string field, one collection/field
    // pair at a time.
    ...SCALAR_DEPARTMENT_FIELDS.map(({ collection, field }) => ({
      label: `${collection}.${field}`,
      run: () => updateScalarField(db, collegeRef.collection(collection), field, oldName, newName),
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
