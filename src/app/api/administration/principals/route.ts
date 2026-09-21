export const dynamic = "force-dynamic";

import { findUsersWithMatchedRole } from "@/lib/roles/findUsersByRoles";
import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

async function fetchCollegePrincipals(db: FirebaseFirestore.Firestore, collegeId: string) {
  // Includes whoever holds the Principal / Vice Principal SEAT (see
  // types/roleSeats.ts), reported under that seat's role - not just accounts
  // whose own role is Principal.
  const matches = await findUsersWithMatchedRole(db, collegeId, ["PRINCIPAL", "VICE_PRINCIPAL"], { exact: true });

  // Deduplicate: a college has exactly one Principal slot. A deactivated
  // holder must NOT count as "existing" - otherwise the Add Principal/VP
  // button stays hidden forever after someone is deactivated, with no way
  // to appoint a replacement from this page.
  let principalSeen = false;
  return matches
    .map((m) => ({ uid: m.doc.id, ...m.doc.data(), role: m.matchedRole }))
    .filter((u) => (u as unknown as { isActive?: boolean }).isActive !== false)
    .filter((u) => {
      if ((u as unknown as { role: string }).role === "PRINCIPAL") {
        if (principalSeen) return false;
        principalSeen = true;
      }
      return true;
    });
}

export async function GET(request: Request) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");

    const db = getAdminDb();

    // No collegeId - bulk mode: every college in this location, in one
    // response, so the Colleges list page can know up front (before any row
    // is expanded) whether each one already has its Principal/VP filled,
    // instead of defaulting to "show the Add button" until a lazy per-row
    // fetch resolves.
    if (!collegeId) {
      const collegesSnap = await db.collection("colleges").where("locationId", "==", session.locationId).get();
      const entries = await Promise.all(
        collegesSnap.docs.map(async (c) => [c.id, await fetchCollegePrincipals(db, c.id)] as const)
      );
      return NextResponse.json({ principalsByCollege: Object.fromEntries(entries) });
    }

    // Verify college belongs to this location
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const collegeData = collegeSnap.data() as { locationId?: string };
    if (collegeData.locationId !== session.locationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const principals = await fetchCollegePrincipals(db, collegeId);
    return NextResponse.json({ principals });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[administration/principals GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// No POST here any more - Location Admin no longer creates a Principal or
// Vice Principal account directly. That bypassed the seat model entirely
// (a fresh account whose own role WAS "PRINCIPAL"/"VICE_PRINCIPAL", only
// wrapped into a seat afterward by convertLegacyAccounts). The College Admin
// - itself the one seat Location Admin does bootstrap, from
// administration/college-people - appoints the Principal and every other
// seat from within the college, via Role Assignments.
