export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Read-only: the departments of one college in the caller's location, for the
// Administration Colleges → Departments → Faculty browse.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { collegeId } = await params;

    const db = getAdminDb();
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    const college = collegeSnap.data() as { name?: string; locationId?: string } | undefined;
    if (!college || college.locationId !== session.locationId) {
      return NextResponse.json({ error: "College not found. It may have been deleted." }, { status: 404 });
    }

    const snap = await collegeSnap.ref.collection("departments").orderBy("name").get();
    const departments = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    return NextResponse.json({ departments, collegeName: college.name ?? "" });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[administration/colleges/departments GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
