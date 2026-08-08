// Resolves an HOD's department-scoping info, including sub-department (child
// Department) awareness. Centralizes what used to be a duplicated per-route
// `getHodDept()` - the difference here is `childDepartmentNames`, used to
// grant a parent department's HOD automatic view-only ("secondary") access
// to every sub-department's students/sections/assigned faculty.
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
}

export async function getHodDepartmentScope(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<HodDepartmentScope> {
  const userSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  const departmentName = (userSnap.data() as { department?: string } | undefined)?.department ?? "";

  if (!departmentName) {
    return { departmentName: "", departmentId: null, childDepartmentNames: [], childDepartmentIds: [] };
  }

  const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
  const deptSnap = await deptsColl.where("name", "==", departmentName).limit(1).get();
  if (deptSnap.empty) {
    return { departmentName, departmentId: null, childDepartmentNames: [], childDepartmentIds: [] };
  }

  const deptDoc = deptSnap.docs[0];
  const dept = deptDoc.data() as { hasSubDepartments?: boolean };

  let childDepartmentNames: string[] = [];
  let childDepartmentIds: string[] = [];
  if (dept.hasSubDepartments) {
    const childrenSnap = await deptsColl.where("parentDepartmentId", "==", deptDoc.id).get();
    // Firestore `in` filters cap at 30 values - realistically a handful of sub-departments per parent.
    const children = childrenSnap.docs
      .map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name ?? "" }))
      .filter((d) => d.name)
      .slice(0, 30);
    childDepartmentNames = children.map((d) => d.name);
    childDepartmentIds = children.map((d) => d.id);
  }

  return { departmentName, departmentId: deptDoc.id, childDepartmentNames, childDepartmentIds };
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
// sub-department) and its children (if it has sub-departments), so a faculty
// member registered under either the main department or one of its
// sub-departments shows up as assignable either way.
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

  if (dept.hasSubDepartments) {
    const childrenSnap = await deptsColl.where("parentDepartmentId", "==", deptDoc.id).get();
    for (const d of childrenSnap.docs) {
      const name = (d.data() as { name?: string }).name;
      if (name) names.add(name);
    }
  }

  return Array.from(names).slice(0, 30);
}
