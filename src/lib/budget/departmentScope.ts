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

export async function resolveUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  return (await resolveUserProfile(db, collegeId, uid)).name;
}

// HOD -> filtered to their own department (real Firestore .where, fails closed to an
// empty result if the HOD has no department set, never falls back to "all").
// PRINCIPAL / VICE_PRINCIPAL / FINANCE / SUPER_ADMIN -> unscoped (all-departments view).
// Callers must NOT chain .orderBy() onto the result — where(department) + orderBy(other
// field) needs a composite index; sort in-memory after .get() instead (same idiom as
// leave-applications/route.ts).
export async function scopeBudgetQueryByDepartment(
  db: Firestore,
  baseQuery: FirebaseFirestore.Query,
  session: DeptScopeSession
): Promise<FirebaseFirestore.Query> {
  if (session.role !== "HOD") return baseQuery;
  const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
  return baseQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
}
