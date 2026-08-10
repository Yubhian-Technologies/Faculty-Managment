// Resolves an HOD's department-scoping info, including sub-department (child
// Department) awareness. Centralizes what used to be a duplicated per-route
// `getHodDept()` - the difference here is `childDepartmentNames`, used to
// extend a parent department's HOD across every sub-department.
//
// A parent department's HOD has FULL control over their own department and all
// of its sub-departments: they can create sections, add subjects, add faculty,
// and make teaching assignments in any of them, alongside the sub-HOD who runs
// each child day to day. A sub-HOD's scope stays limited to their own child
// department - authority flows down the tree, never up or sideways.
// Use `canHodEditDepartment` / `editableDepartmentNames` for that check rather
// than comparing `departmentName` directly, so the rule stays in one place.
export interface HodDepartmentScope {
  departmentName: string;
  departmentId: string | null;
  // Populated only when this HOD's own department has hasSubDepartments -
  // the names of its child departments, for cross-department queries.
  childDepartmentNames: string[];
  // Same set, by id (same order) - needed wherever a route must validate a
  // *target* department id (e.g. reassigning a section to a sub-department)
  // rather than just querying by name.
  childDepartmentIds: string[];
  // Grouped (managed) departments: the top-level branches (e.g. IT, CSBS) a
  // sub-HOD has been given FULL control of via their own sub-department's
  // `managedDepartments` list. Unlike `secondaryDepartments` (cross-list /
  // view-only "incoming" access), these are fully editable - the sub-HOD sees,
  // sections, and manages those branches' students and academics as if they
  // were their own. Empty for a plain HOD with no grouping configured.
  managedDepartmentNames: string[];
  // Same set, by id (same order) - for routes that validate a target id.
  managedDepartmentIds: string[];
}

/**
 * Every department name this HOD may WRITE to: their own, every sub-department
 * beneath it, and every grouped/managed branch. For a sub-HOD this is their own
 * sub-department plus whatever branches were grouped under it (often none).
 */
export function editableDepartmentNames(scope: HodDepartmentScope): string[] {
  return scope.departmentName
    ? [scope.departmentName, ...scope.childDepartmentNames, ...scope.managedDepartmentNames]
    : [];
}

/** True when `departmentName` is this HOD's own department, a child, or a managed branch. */
export function canHodEditDepartment(scope: HodDepartmentScope, departmentName: string): boolean {
  if (!departmentName) return false;
  return editableDepartmentNames(scope).includes(departmentName);
}

/** Same check by department id, for routes that receive an id rather than a name. */
export function canHodEditDepartmentId(scope: HodDepartmentScope, departmentId: string): boolean {
  if (!departmentId) return false;
  return (
    departmentId === scope.departmentId ||
    scope.childDepartmentIds.includes(departmentId) ||
    scope.managedDepartmentIds.includes(departmentId)
  );
}

export async function getHodDepartmentScope(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<HodDepartmentScope> {
  const userSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  const departmentName = (userSnap.data() as { department?: string } | undefined)?.department ?? "";

  const empty: HodDepartmentScope = {
    departmentName: "",
    departmentId: null,
    childDepartmentNames: [],
    childDepartmentIds: [],
    managedDepartmentNames: [],
    managedDepartmentIds: [],
  };

  if (!departmentName) {
    return empty;
  }

  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const deptSnap = await deptsColl.where("name", "==", departmentName).limit(1).get();
  if (deptSnap.empty) {
    return { ...empty, departmentName };
  }

  const deptDoc = deptSnap.docs[0];
  const dept = deptDoc.data() as { hasSubDepartments?: boolean; managedDepartments?: string[] };

  let childDepartmentNames: string[] = [];
  let childDepartmentIds: string[] = [];
  // Start with this department's own grouped branches; a parent HOD also rolls
  // up every branch grouped under its sub-HODs (below), so e.g. the Basic
  // Science HOD manages IT/CSE that a BS-Maths sub-HOD manages - "manages the
  // whole tree", not just the direct sub-departments.
  const managedNameSet = new Set((dept.managedDepartments ?? []).map((n) => n.trim()).filter(Boolean));
  if (dept.hasSubDepartments) {
    const childrenSnap = await deptsColl.where("parentDepartmentId", "==", deptDoc.id).get();
    // Firestore `in` filters cap at 30 values - realistically a handful of sub-departments per parent.
    const children = childrenSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { name?: string; managedDepartments?: string[] }) }))
      .filter((d) => d.name)
      .slice(0, 30);
    childDepartmentNames = children.map((d) => d.name as string);
    childDepartmentIds = children.map((d) => d.id);
    for (const c of children) {
      for (const n of c.managedDepartments ?? []) {
        const t = n.trim();
        if (t) managedNameSet.add(t);
      }
    }
  }

  // Grouped/managed branches: resolve the collected `managedDepartments` names
  // (own + sub-HODs') to their department ids (skip any that no longer exist).
  // Capped at 30 to stay within Firestore `in`-query limits at the call sites.
  const managedDepartmentNames: string[] = [];
  const managedDepartmentIds: string[] = [];
  const managedNames = Array.from(managedNameSet).slice(0, 30);
  if (managedNames.length > 0) {
    const managedSnaps = await Promise.all(
      managedNames.map((n) => deptsColl.where("name", "==", n).limit(1).get())
    );
    for (let i = 0; i < managedNames.length; i++) {
      const doc = managedSnaps[i].docs[0];
      if (!doc) continue;
      managedDepartmentNames.push(managedNames[i]);
      managedDepartmentIds.push(doc.id);
    }
  }

  return {
    departmentName,
    departmentId: deptDoc.id,
    childDepartmentNames,
    childDepartmentIds,
    managedDepartmentNames,
    managedDepartmentIds,
  };
}

// Keeps a department's `hodUid`/`hodName` pointer in sync with an HOD-role
// login's own `department` field - the field that actually drives their
// dashboard access (see getHodDepartmentScope above). The "Assign HOD"
// dropdown on the Departments page already keeps both sides in sync when
// used (college/departments POST/PATCH); this covers every *other* place an
// HOD-role login's `department` can be set (account creation, profile edits)
// so the department doc's hodUid can't drift from who is actually working as
// that department's HOD - which otherwise shows as "No HOD assigned" even
// though the HOD's own dashboard works fine, and misroutes anything that
// notifies/approves via departments.hodUid (budget, recruitment, indents).
// No-ops if the role isn't HOD, there's no department, or nothing's out of sync.
export async function syncDepartmentHod(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  hod: { uid: string; role: string; name: string; department?: string }
): Promise<void> {
  if (hod.role !== "HOD" || !hod.department) return;
  const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments")
    .where("name", "==", hod.department).limit(1).get();
  if (deptSnap.empty) return;
  const deptDoc = deptSnap.docs[0];
  if ((deptDoc.data() as { hodUid?: string }).hodUid === hod.uid) return;
  await deptDoc.ref.update({ hodUid: hod.uid, hodName: hod.name, updatedAt: new Date() }).catch(() => {});
}

// For a caller who names one specific department explicitly (Office/Principal/
// VP picking a department for a section, faculty filter, etc.) rather than
// resolving their own - returns that department plus its parent (if it's a
// sub-department), its children (if it has sub-departments), and any
// unrelated top-level department that cross-lists it as a `secondaryDepartments`
// feeder (e.g. a shared first-year "Basic Science" department feeding CSE/ECE/IT -
// see the field's doc in types/core.ts) - so a faculty member OR a subject
// registered under any of those shows up as usable from this department too.
// A fed department (IT) never defines its own copy of the feeder's first-year
// subjects, so without this it can see none of them at all.
export async function getRelatedDepartmentNames(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  departmentName: string
): Promise<string[]> {
  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const deptSnap = await deptsColl.where("name", "==", departmentName).limit(1).get();
  if (deptSnap.empty) return [departmentName];

  const deptDoc = deptSnap.docs[0];
  const dept = deptDoc.data() as { parentDepartmentId?: string; hasSubDepartments?: boolean };
  const names = new Set<string>([departmentName]);

  if (dept.parentDepartmentId) {
    const parentSnap = await deptsColl.doc(dept.parentDepartmentId).get();
    const parentName = (parentSnap.data() as { name?: string } | undefined)?.name;
    if (parentName) names.add(parentName);
  }

  const feederSnap = await deptsColl.where("secondaryDepartments", "array-contains", departmentName).get();
  for (const d of feederSnap.docs) {
    const name = (d.data() as { name?: string }).name;
    if (name) names.add(name);
  }

  if (dept.hasSubDepartments) {
    const childrenSnap = await deptsColl.where("parentDepartmentId", "==", deptDoc.id).get();
    for (const d of childrenSnap.docs) {
      const name = (d.data() as { name?: string }).name;
      if (name) names.add(name);
    }
  }

  return Array.from(names).slice(0, 30);
}

/** Id-keyed counterpart of getRelatedDepartmentNames, for callers (course
 * lookups) that filter by departmentId rather than department name - own id,
 * parent (if this department is itself a child), and feeder (if this
 * department is fed by another). Deliberately NOT children: a true
 * sub-department always borrows its parent's course rather than owning one
 * of its own, so there's nothing for a parent to gain by reaching down into a
 * child's own course row - doing so previously surfaced an unrelated stray
 * course under the parent's own dropdown and broke subject creation there. */
export async function getRelatedDepartmentIds(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  departmentId: string
): Promise<string[]> {
  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const deptSnap = await deptsColl.doc(departmentId).get();
  if (!deptSnap.exists) return [departmentId];

  const dept = deptSnap.data() as { name?: string; parentDepartmentId?: string };
  const ids = new Set<string>([departmentId]);

  if (dept.parentDepartmentId) ids.add(dept.parentDepartmentId);

  if (dept.name) {
    const feederSnap = await deptsColl.where("secondaryDepartments", "array-contains", dept.name).get();
    for (const d of feederSnap.docs) ids.add(d.id);
  }

  return Array.from(ids).slice(0, 30);
}

// A department fed by another (Department.secondaryDepartments - e.g. a shared
// first-year "Basic Science" feeding every other department in the college)
// doesn't own the years the feeder has reserved for itself
// (Department.assignedYears, e.g. [1]) - a subject filed for one of those
// years belongs to the feeder instead, so every fed department reads from one
// shared 1st-year list rather than each re-entering it. Years outside the
// feeder's assignedYears stay with the target department itself (e.g. IT's
// own 2nd-year subjects, CSE's own 2nd-year subjects). Picks the first feeder
// that actually claims the year; a department with no such feeder (or whose
// feeder doesn't reserve this year) resolves to itself.
export async function resolveSubjectDepartment(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  targetDepartmentName: string,
  year: number
): Promise<string> {
  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const feederSnap = await deptsColl.where("secondaryDepartments", "array-contains", targetDepartmentName).get();
  for (const d of feederSnap.docs) {
    const data = d.data() as { name?: string; assignedYears?: number[] };
    if (data.name && (data.assignedYears ?? []).includes(year)) {
      return data.name;
    }
  }
  return targetDepartmentName;
}
