export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";

// Looks up an internal author's name by Employee ID, within the caller's own
// college only - used when recording a publication's Internal author (see
// PublicationDetailsForm) so their name is pulled from the real record
// instead of being retyped by hand.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);
    const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim();
    if (!employeeId) return NextResponse.json({ error: "employeeId required" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("facultyMembers")
      .where("employeeId", "==", employeeId).limit(1).get();
    if (snap.empty) return NextResponse.json({ error: "No faculty member found with that Employee ID" }, { status: 404 });

    const f = snap.docs[0].data() as { name?: string; legalName?: string };
    return NextResponse.json({ name: f.name || f.legalName || "" });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-lookup GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
