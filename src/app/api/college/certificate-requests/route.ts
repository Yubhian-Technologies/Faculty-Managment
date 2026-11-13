export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { listExamCellQueue, listInbox, listIssuanceQueue, listMine } from "@/lib/certifications/service";
import { CertificationError } from "@/lib/certifications/types";
import { studentCatalog, submitConfigured } from "@/lib/certifications/configured";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { loadTypes } from "@/lib/certifications/store";
import { namesUser } from "@/lib/certifications/typeConfig";

export async function GET(request: Request) {
  try {
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const view = new URL(request.url).searchParams.get("view") ?? "mine";
    // For the menu: is this login an approver / issuer - something waiting on them now, or named as a person in an
    // active certificate's approvals or as its issuer? No request data is returned.
    if (view === "exists") {
      const snap = await CERTIFICATE_REQUESTS_COL(db, session.collegeId).where("pendingRecipientUids", "array-contains", session.uid).limit(1).get();
      if (!snap.empty) return NextResponse.json({ exists: true });
      const named = (await loadTypes(db, session.collegeId)).some((t) => t.isActive && namesUser(t, session.uid));
      return NextResponse.json({ exists: named });
    }
    // The certificates the student may apply for (with their own requests below them).
    if (view === "catalog") {
      if (session.role !== "STUDENT") return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
      const [catalog, requests] = await Promise.all([studentCatalog(db, user), listMine(db, user)]);
      return NextResponse.json({ ...catalog, requests });
    }

    const requests =
      view === "inbox" ? await listInbox(db, user)
      : view === "issuance-queue" ? await listIssuanceQueue(db, user)
      : view === "exam-cell-queue" ? await listExamCellQueue(db, user)
      : await listMine(db, user);

    return NextResponse.json({ requests });
  } catch (err) {
    return failure(err, "certificate-requests GET");
  }
}

export async function POST(request: Request) {
  try {
    const session = await authenticate("STUDENT");
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = await readJson(request);
    // Every request names its configured type; the original No Due prototype (no type) is replaced by the
    // configured No Dues, which the College Office starts for a batch.
    const typeId = (body as { typeId?: unknown } | null)?.typeId;
    if (!typeId) throw new CertificationError("INVALID", "Pick a certificate", 400);
    const { alreadyExists, request: req } = await submitConfigured(db, user, body);
    return NextResponse.json({ alreadyExists, request: req }, { status: alreadyExists ? 200 : 201 });
  } catch (err) {
    return failure(err, "certificate-requests POST");
  }
}
