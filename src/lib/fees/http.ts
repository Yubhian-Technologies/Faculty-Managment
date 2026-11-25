import type { Firestore } from "firebase-admin/firestore";
import { requirePaymentsManager } from "@/lib/payments/server";

// Student fees are managed by the location Accounts login (and Super Admin) for a college picked as ?collegeId -
// the same check as online payments. Returns the session with the college and the actor's display name.
export async function requireFeesManager(db: Firestore, request: Request) {
  const session = await requirePaymentsManager(db, request);
  const byName = await actorName(db, session);
  return { ...session, byName };
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

/** Who marks FR / NFR and records the government's fee reimbursement money (own college). */
export const SCHOLARSHIP_ROLES = ["SCHOLARSHIP_CELL", "SUPER_ADMIN"] as const;
