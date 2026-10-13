export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { getRequest } from "@/lib/certifications/service";
import type { StudentRecord } from "@/types";

// The requesting student's full roster record, for whoever is looking at
// this one certificate request - getRequest() already proves the caller is
// a legitimate party to THIS request (the requester, a current/past
// recipient, or the issuer), so a Library/Hostel/PD/Placement login that has
// no other reason to browse students at all can still see full context for
// a student who actually landed in their queue - without widening
// college/students/[id] GET's own role list for everyone else.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const certRequest = await getRequest(db, user, id);

    const studentSnap = await db.collection("colleges").doc(user.collegeId).collection("students").doc(certRequest.studentId).get();
    if (!studentSnap.exists) return NextResponse.json({ error: "Student record not found" }, { status: 404 });

    const student = { ...(studentSnap.data() as StudentRecord), id: studentSnap.id };
    return NextResponse.json({ student });
  } catch (err) {
    return failure(err, "certificate-requests/[id]/student GET");
  }
}
