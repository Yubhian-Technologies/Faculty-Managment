export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { CertificationError } from "@/lib/certifications/types";
import { cancel, decide, getRequest, resubmit, returnRequest } from "@/lib/certifications/service";

interface Body {
  action: "APPROVE" | "REJECT" | "CANCEL" | "RETURN" | "RESUBMIT";
  branchKey?: string;
  remarks?: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const req = await getRequest(db, user, id);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id] GET");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await readJson(request)) as Body;

    if (body.action === "CANCEL") {
      const req = await cancel(db, user, id);
      return NextResponse.json({ request: req });
    }
    if (body.action === "RETURN") {
      const req = await returnRequest(db, user, id, String(body.remarks ?? "").trim(), body.branchKey);
      return NextResponse.json({ request: req });
    }
    if (body.action === "RESUBMIT") {
      const req = await resubmit(db, user, id, body);
      return NextResponse.json({ request: req });
    }
    if (body.action !== "APPROVE" && body.action !== "REJECT") {
      throw new CertificationError("INVALID", "action must be APPROVE, REJECT, RETURN, RESUBMIT or CANCEL", 400);
    }
    const req = await decide(db, user, id, body.action, body.remarks, body.branchKey);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id] PATCH");
  }
}
