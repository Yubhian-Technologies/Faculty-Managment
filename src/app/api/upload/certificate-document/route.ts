export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { canDecide } from "@/lib/certifications/decisionRules";
import { CertificationError } from "@/lib/certifications/types";
import { storeUpload } from "@/lib/certifications/uploadFile";
import type { CertificateRequest } from "@/types";

// The PDF of an uploaded-kind certificate (degree, provisional) - only by the request's issuer, while it waits
// to be issued. Stored under the request, which is the only folder its issue accepts.
export async function POST(request: Request) {
  try {
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    if (!requestId) throw new CertificationError("INVALID", "requestId is required", 400);
    const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(requestId).get();
    const req = snap.exists ? ({ id: snap.id, ...snap.data() } as CertificateRequest) : null;
    if (!req) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    if (req.status !== "PENDING_ISSUANCE" || !canDecide(user.uid, req.requesterUid, req.pendingRecipientUids)) {
      throw new CertificationError("FORBIDDEN", "You can't upload this certificate", 403);
    }
    const { url } = await storeUpload(request, `certificate-uploads/${user.collegeId}/${req.id}`, ["pdf"], 10 * 1024 * 1024);
    return NextResponse.json({ url });
  } catch (err) {
    return failure(err, "upload/certificate-document POST");
  }
}
