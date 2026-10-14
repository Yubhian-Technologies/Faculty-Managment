export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure } from "@/lib/certifications/http";
import { listDepartmentOverview } from "@/lib/certifications/service";

// HOD-only: every certificate request filed by a student in their own
// department(s), bucketed per section into in-progress vs completed - not
// the generic ANY_CERTIFICATE_ACTOR_ROLE list, since this is a
// department-wide view rather than "can act on this one request".
export async function GET() {
  try {
    const session = await authenticate("HOD");
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const rows = await listDepartmentOverview(db, user);
    return NextResponse.json({ rows });
  } catch (err) {
    return failure(err, "certificate-requests/overview GET");
  }
}
