export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApprovalError } from "@/lib/approvals";
import { actingUser, ANY_PERMISSION_ROLE, authenticate, failure, readJson } from "@/lib/studentPermissions/http";
import { cancelRequest, decide, getRequest, retryEffects, revokeRequest } from "@/lib/studentPermissions/service";

type Ctx = { params: Promise<{ id: string }> };

// One request, visible only to people involved with it (requester, covered student,
// the department's HOD, Vice Principal / Principal, the class incharge).
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const { id } = await params;
    return NextResponse.json({ request: await getRequest(db, await actingUser(db, session), id) });
  } catch (err) {
    return failure(err, "college/student-permissions/[id] GET");
  }
}

// Act on a request: APPROVE / REJECT (the current stage's approver), CANCEL (the
// requester, while pending), REVOKE (whoever decided the final stage, after approval),
// RETRY (re-run a failed attendance update). Who may do what is decided by the
// approvals engine and the permission kind, not by this route.
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const { id } = await params;
    const body = (await readJson(request)) as { action?: string; remark?: string };
    const user = await actingUser(db, session);
    const remark = typeof body.remark === "string" ? body.remark.slice(0, 500) : undefined;

    switch (body.action) {
      case "APPROVE": return NextResponse.json({ request: await decide(db, user, id, "APPROVE", remark) });
      case "REJECT": return NextResponse.json({ request: await decide(db, user, id, "REJECT", remark) });
      case "CANCEL": return NextResponse.json({ request: await cancelRequest(db, user, id, remark) });
      case "REVOKE": return NextResponse.json({ request: await revokeRequest(db, user, id, remark ?? "") });
      case "RETRY": return NextResponse.json({ request: await retryEffects(db, user, id) });
      default: throw new ApprovalError("INVALID", "Unknown action", 400);
    }
  } catch (err) {
    return failure(err, "college/student-permissions/[id] PATCH");
  }
}
