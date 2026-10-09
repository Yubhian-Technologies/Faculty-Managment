export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { BULK_COLLEGE_EMAIL_MAX_ROWS_PER_CALL, bulkChangeCollegeEmails, type BulkCollegeEmailRecord } from "@/lib/faculty/bulkCollegeEmail";

// Bulk Change College Email (College Office only): rows of { Employee ID, New College Email }. Every row is handled by the
// same changeFacultyCollegeEmail the single button uses (lib/faculty/bulkCollegeEmail.ts), so each row either fully
// updates every copy of the email - and signs that person out everywhere - or changes nothing. A refused row never
// affects another row. The page sends small chunks (each row makes several Auth + Firestore calls).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await readJsonBody(request)) as { records?: BulkCollegeEmailRecord[] };
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > BULK_COLLEGE_EMAIL_MAX_ROWS_PER_CALL) {
      return NextResponse.json({ error: `At most ${BULK_COLLEGE_EMAIL_MAX_ROWS_PER_CALL} rows per request` }, { status: 400 });
    }

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const outcome = await bulkChangeCollegeEmails(db, await getAdminAuth(), {
      collegeId: session.collegeId,
      actor: { uid: session.uid, name: (actorSnap.data() as { name?: string } | undefined)?.name },
      records: body.records,
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/college-email-import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
