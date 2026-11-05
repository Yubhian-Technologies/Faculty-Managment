export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { CertificationError } from "@/lib/certifications/types";
import { cancel, decide, duesPending, getRequest, resubmit, returnRequest } from "@/lib/certifications/service";

interface Body {
  action: "APPROVE" | "REJECT" | "CANCEL" | "RETURN" | "RESUBMIT" | "DUES_PENDING";
  branchKey?: string;
  remarks?: string;
  /** A dues check's clearance: NO_DUES or NOT_APPLICABLE (with APPROVE). */
  outcome?: "NO_DUES" | "NOT_APPLICABLE";
  /** DUES_PENDING: what the student owes. */
  amount?: number;
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
    if (body.action === "DUES_PENDING") {
      if (!body.branchKey) throw new CertificationError("INVALID", "branchKey is required", 400);
      const req = await duesPending(db, user, id, body.branchKey, Number(body.amount), String(body.remarks ?? ""));
      return NextResponse.json({ request: req });
    }
    if (body.action === "RESUBMIT") {
      const req = await resubmit(db, user, id, body);
      return NextResponse.json({ request: req });
    }
    if (body.action !== "APPROVE" && body.action !== "REJECT") {
      throw new CertificationError("INVALID", "action must be APPROVE, REJECT, RETURN, RESUBMIT or CANCEL", 400);
    }
    const outcome = body.outcome === "NO_DUES" || body.outcome === "NOT_APPLICABLE" ? body.outcome : undefined;
    const req = await decide(db, user, id, body.action, body.remarks, body.branchKey, outcome);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id] PATCH");
  }
}
