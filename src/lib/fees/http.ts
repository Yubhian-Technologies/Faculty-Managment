import type { Firestore } from "firebase-admin/firestore";
import { requireRole } from "@/lib/auth/verifySession";
import { PaymentError, requirePaymentsManager } from "@/lib/payments/server";

// Student fees are managed by the location Accounts login (and Super Admin) for a college picked as ?collegeId -
// the same check as online payments. Returns the session with the college and the actor's display name.
export async function requireFeesManager(db: Firestore, request: Request) {
  const session = await requirePaymentsManager(db, request);
  const byName = await actorName(db, session);
  return { ...session, byName };
}

/**
 * Taking fees at the counter (Collect: find a student, see their fee, record a payment, start a CCAvenue payment):
 * Accounts / Super Admin for any college of their location (as above), and the College Office for its OWN college
 * only. `canCancel` is false for the College Office - cancelling a receipt and the Day Book stay with Accounts.
 */
export async function requireFeesCollector(db: Firestore, request: Request) {
  const session = await requireRole("ACCOUNTS", "SUPER_ADMIN", "COLLEGE_OFFICE");
  if (session.role === "COLLEGE_OFFICE") {
    const asked = new URL(request.url).searchParams.get("collegeId");
    if (!session.collegeId || (asked && asked !== session.collegeId)) throw new PaymentError("You can collect fees only for your own college.", 403);
    return { ...session, collegeId: session.collegeId, byName: await actorName(db, session), canCancel: false };
  }
  return { ...(await requireFeesManager(db, request)), canCancel: true };
}

export async function actorName(db: Firestore, session: { uid: string; email?: string; collegeId?: string; locationId?: string }): Promise<string> {
  const tries = [
    session.collegeId ? db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid) : null,
    db.collection("systemUsers").doc(session.uid),
    session.locationId ? db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid) : null,
  ].filter(Boolean) as FirebaseFirestore.DocumentReference[];
  for (const ref of tries) {
    const name = ((await ref.get()).data() as { name?: string } | undefined)?.name;
    if (name) return name;
  }
  return session.email ?? "";
}

/** Who marks FR / NFR and records the government's fee reimbursement money: the location Scholarship Cell. */
export const SCHOLARSHIP_ROLES = ["SCHOLARSHIP_CELL", "SUPER_ADMIN"] as const;

/** The location Scholarship Cell (or Super Admin) for the college picked as ?collegeId - it must be in their
 *  location (same check as Accounts). Returns the session with the college and the actor's name. */
export async function requireScholarshipManager(db: Firestore, request: Request) {
  const session = await requireRole(...SCHOLARSHIP_ROLES);
  const collegeId = new URL(request.url).searchParams.get("collegeId") || session.collegeId || "";
  if (!collegeId) throw new PaymentError("Pick a college", 400);
  if (session.role === "SCHOLARSHIP_CELL") {
    const snap = await db.collection("colleges").doc(collegeId).get();
    const loc = (snap.data() as { locationId?: string } | undefined)?.locationId;
    if (!snap.exists || !session.locationId || loc !== session.locationId) throw new PaymentError("This college isn't in your location", 403);
  }
  const withCollege = { ...session, collegeId };
  return { ...withCollege, byName: await actorName(db, withCollege) };
}
