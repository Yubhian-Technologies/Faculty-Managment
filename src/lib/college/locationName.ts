import type { Firestore } from "firebase-admin/firestore";

// The college's own campus/location name (e.g. "Bhimavaram") - not the
// per-person location-scoped session field (session.locationId is only ever
// populated for LOCATION_SCOPED_ROLES, never for college roles like
// COLLEGE_OFFICE/PRINCIPAL - see api/auth/session/route.ts), so this always
// goes by way of the college doc's own `locationId` instead.
export async function resolveCollegeLocationName(db: Firestore, collegeId: string): Promise<string | undefined> {
  const collegeSnap = await db.collection("colleges").doc(collegeId).get();
  const locationId = (collegeSnap.data() as { locationId?: string } | undefined)?.locationId;
  if (!locationId) return undefined;
  const locationSnap = await db.collection("locations").doc(locationId).get();
  return (locationSnap.data() as { name?: string } | undefined)?.name;
}
