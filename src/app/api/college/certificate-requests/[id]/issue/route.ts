export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { CertificationError } from "@/lib/certifications/types";
import { issue, rejectAtIssuance } from "@/lib/certifications/service";

const ISSUER_ROLES = ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ISSUER_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
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
    const session = await authenticate(...ISSUER_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
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
