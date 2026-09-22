export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

const MANAGED = ["COLLEGE_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];

// The College Admin, Principal and Vice Principal of a college, read from the
// RAW stored roles (a College Admin normalizes to Principal elsewhere, which
// would hide it here). Deactivated accounts are left out.
async function fetchCollegePrincipals(db: FirebaseFirestore.Firestore, collegeId: string) {
  const users = db.collection("colleges").doc(collegeId).collection("users");
  const [byRole, bySeat] = await Promise.all([
    users.where("role", "in", MANAGED).get(),
    users.where("seatRoles", "array-contains-any", MANAGED).get(),
  ]);
  const seen = new Set<string>();
  const out: { uid: string; name: string; email: string; phone?: string; roles: string[] }[] = [];
  for (const doc of [...byRole.docs, ...bySeat.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const u = doc.data() as { name?: string; email?: string; collegeEmail?: string; phone?: string; role?: string; seatRoles?: string[]; isActive?: boolean };
    if (u.isActive === false) continue;
    const roles = MANAGED.filter((r) => u.role === r || (u.seatRoles ?? []).includes(r));
    out.push({ uid: doc.id, name: u.name ?? "", email: u.collegeEmail || u.email || "", phone: u.phone, roles });
  }
  return out;
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
