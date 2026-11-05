export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { CertificationError } from "@/lib/certifications/types";
import { getRequest, issue, rejectAtIssuance } from "@/lib/certifications/service";
import { issueConfigured } from "@/lib/certifications/configured";

// The original No Due flow is issued by these roles; a configured type names its own issuer (a role, the
// Exam Cell, a person), so any college login may call - the transaction proves they are THIS request's issuer.
const NO_DUE_ISSUER_ROLES: readonly string[] = ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const current = await getRequest(db, user, id);
    if (current.certificateTypeId) {
      const req = await issueConfigured(db, user, id, await readJson(request), new URL(request.url).origin);
      return NextResponse.json({ request: req });
    }
    if (!NO_DUE_ISSUER_ROLES.includes(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await readJson(request)) as { certificateUrl?: string; certificateNumber?: string };
    if (!body.certificateUrl || !body.certificateNumber) {
      throw new CertificationError("INVALID", "certificateUrl and certificateNumber are required", 400);
    }
    const req = await issue(db, user, id, body.certificateUrl, body.certificateNumber);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id]/issue POST");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const current = await getRequest(db, user, id);
    if (!current.certificateTypeId && !NO_DUE_ISSUER_ROLES.includes(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await readJson(request)) as { action?: string; remarks?: string };
    if (body.action !== "REJECT" || !body.remarks) {
      throw new CertificationError("INVALID", "action must be REJECT with remarks", 400);
    }
    const req = await rejectAtIssuance(db, user, id, body.remarks);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id]/issue PATCH");
  }
}
