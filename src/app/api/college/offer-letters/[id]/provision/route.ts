export const dynamic = "force-dynamic";

// Manually trigger faculty account creation for an already-sent offer letter.
// Used when an offer letter was marked SENT before the auto-provision feature was added.

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer } from "@/lib/firestore/facultyProvisioning";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();

    const result = await provisionFacultyFromOffer(db, session.collegeId, id);

    switch (result.status) {
      case "not_found":
        return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
      case "no_email":
        return NextResponse.json(
          { error: "Candidate has no email on file, or an account already exists under a different user" },
          { status: 400 }
        );
      case "already_exists":
        return NextResponse.json({ ok: true, alreadyExists: true, facultyId: result.facultyId });
      case "created":
        return NextResponse.json({
          ok: true,
          facultyId: result.facultyId,
          employeeId: result.employeeId,
          generatedPassword: result.generatedPassword,
        });
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/provision POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
