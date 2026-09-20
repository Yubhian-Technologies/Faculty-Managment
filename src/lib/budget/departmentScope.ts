import type { Firestore } from "firebase-admin/firestore";

export interface DeptScopeSession {
  uid: string;
  role: string;
  collegeId: string;
}

export async function resolveUserProfile(
  db: Firestore,
  collegeId: string,
  uid: string
): Promise<{ name: string; department: string }> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const data = snap.data() as { name?: string; department?: string } | undefined;
    return { name: data?.name ?? "Unknown", department: data?.department ?? "" };
  } catch {
    return { name: "Unknown", department: "" };
  }
}

export async function resolveUserDepartment(db: Firestore, collegeId: string, uid: string): Promise<string> {
  return (await resolveUserProfile(db, collegeId, uid)).department;
}

// Every department this person runs AS HOD - their HOD seats (see
// types/roleSeats.ts), which keep `departments` on their record in step - or,
// for a plain single-department HOD, just their own `department`. This is what
// HOD-role screens (approvals, department lists, budgets) must scope to: a
// person's own `department` is where they teach, and can differ from a
// department they head (or be only one of two). Personal screens (their own
// leave, teaching load, ...) keep using resolveUserDepartment.
export async function resolveHodDepartments(db: Firestore, collegeId: string, uid: string): Promise<string[]> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const data = snap.data() as { department?: string; departments?: string[] } | undefined;
    const names = data?.departments && data.departments.length > 0 ? data.departments : [data?.department ?? ""];
    return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

export async function resolveUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  return (await resolveUserProfile(db, collegeId, uid)).name;
}

// HOD -> filtered to their own department (real Firestore .where, fails closed to an
// empty result if the HOD has no department set, never falls back to "all").
// PRINCIPAL / VICE_PRINCIPAL / FINANCE / SUPER_ADMIN -> unscoped (all-departments view).
// Callers must NOT chain .orderBy() onto the result - where(department) + orderBy(other
// field) needs a composite index; sort in-memory after .get() instead.
export async function scopeBudgetQueryByDepartment(
  db: Firestore,
  baseQuery: FirebaseFirestore.Query,
  session: DeptScopeSession
): Promise<FirebaseFirestore.Query> {
  if (session.role !== "HOD") return baseQuery;
  const depts = await resolveHodDepartments(db, session.collegeId, session.uid);
  if (depts.length === 0) return baseQuery.where("department", "==", "__NO_DEPARTMENT__");
  return depts.length === 1
    ? baseQuery.where("department", "==", depts[0])
    : baseQuery.where("department", "in", depts.slice(0, 30));
}
