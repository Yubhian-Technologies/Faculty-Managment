export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { CollegeEmailError, changeFacultyCollegeEmail } from "@/lib/faculty/changeCollegeEmail";

// Change a faculty member's COLLEGE EMAIL (their login). College Office only - the faculty member, their HOD and the
// Principal can no longer change it (it is the login, so every copy has to change together; see
// lib/faculty/changeCollegeEmail.ts). The Employee ID is the key and is never changed: the page sends the Employee ID it
// is showing and the server refuses if it is not the one on the record.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { employeeId?: string; newEmail?: string };
    if (typeof body.employeeId !== "string" || typeof body.newEmail !== "string") {
      return NextResponse.json({ error: "employeeId and newEmail are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const result = await changeFacultyCollegeEmail(db, await getAdminAuth(), {
      collegeId: session.collegeId, facultyId: id, expectedEmployeeId: body.employeeId, newEmail: body.newEmail,
      actor: { uid: session.uid, name: (actorSnap.data() as { name?: string } | undefined)?.name },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof CollegeEmailError) {
      return NextResponse.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
    }
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id]/college-email PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
