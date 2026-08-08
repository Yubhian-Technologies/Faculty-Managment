import type { Firestore } from "firebase-admin/firestore";

// CC list for an offer letter email: Principal, Vice Principal, the batch's panel
// members, the HOD, and Accounts (location-scoped - see ROLE_SCOPE in
// src/types/core.ts, profile lives under locations/{locationId}/locationUsers).
// Principal/VP are resolved independently of the batch existing - a missing/
// deleted batch should never silently drop them from CC.
export async function resolveOfferLetterCcEmails(
  db: Firestore,
  collegeId: string,
  batchId: string
): Promise<{ ccEmails: string[]; hodUid?: string; position?: string }> {
  const usersColl = db.collection("colleges").doc(collegeId).collection("users");
  const ccEmails: string[] = [];

  const [collegeSnap, batchSnap, principalVpSnap] = await Promise.all([
    db.collection("colleges").doc(collegeId).get(),
    batchId ? db.collection("colleges").doc(collegeId).collection("hiringBatches").doc(batchId).get() : Promise.resolve(null),
    usersColl.where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"]).get(),
  ]);
  for (const d of principalVpSnap.docs) {
    const email = (d.data() as { email?: string }).email;
    if (email) ccEmails.push(email);
  }

  const collegeLocationId = (collegeSnap.data() as { locationId?: string } | undefined)?.locationId ?? "";
  const accountsSnap = collegeLocationId
    ? await db.collection("locations").doc(collegeLocationId).collection("locationUsers").where("role", "==", "ACCOUNTS").get()
    : null;
  for (const d of accountsSnap?.docs ?? []) {
    const email = (d.data() as { email?: string }).email;
    if (email) ccEmails.push(email);
  }

  let hodUid: string | undefined;
  let position: string | undefined;
  if (batchSnap?.exists) {
    const batch = batchSnap.data() as { hodUid?: string; position?: string; panelMemberUids?: string[] };
    hodUid = batch.hodUid;
    position = batch.position;

    const panelUids = (batch.panelMemberUids ?? []).slice(0, 30); // Firestore 'in' cap
    const [panelSnap, hodSnap] = await Promise.all([
      panelUids.length > 0 ? usersColl.where("__name__", "in", panelUids).get() : Promise.resolve(null),
      batch.hodUid ? usersColl.doc(batch.hodUid).get() : Promise.resolve(null),
    ]);
    for (const d of panelSnap?.docs ?? []) {
      const email = (d.data() as { email?: string }).email;
      if (email) ccEmails.push(email);
    }
    if (hodSnap?.exists) {
      const email = (hodSnap.data() as { email?: string } | undefined)?.email;
      if (email) ccEmails.push(email);
    }
  }

  return { ccEmails: Array.from(new Set(ccEmails)), hodUid, position };
}
