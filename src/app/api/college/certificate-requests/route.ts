export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { listExamCellQueue, listInbox, listIssuanceQueue, listMine, submitRequest } from "@/lib/certifications/service";

export async function GET(request: Request) {
  try {
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const view = new URL(request.url).searchParams.get("view") ?? "mine";

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
    const { alreadyExists, request: req } = await submitRequest(db, user, body);
    return NextResponse.json({ alreadyExists, request: req }, { status: alreadyExists ? 200 : 201 });
  } catch (err) {
    return failure(err, "certificate-requests POST");
  }
}
