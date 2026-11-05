export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { getRequest } from "@/lib/certifications/service";
import { resultCheck } from "@/lib/certifications/configured";

// The student's Pass / Fail from their PUBLISHED results (and the backlog subject codes), for the Exam Cell's line
// of a No Dues - shown before they approve. Only for someone who is a party to the request.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const req = await getRequest(db, user, id);
    return NextResponse.json({ result: await resultCheck(db, user.collegeId, req.studentId) });
  } catch (err) {
    return failure(err, "certificate-requests/[id]/result GET");
  }
}
