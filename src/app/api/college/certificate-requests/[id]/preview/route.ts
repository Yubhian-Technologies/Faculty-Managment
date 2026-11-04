export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { previewIssue } from "@/lib/certifications/configured";

// The certificate as it will be issued, with the issuer's entries so far - for this request's issuer only.
// Writes nothing (the number is given on issue).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const built = await previewIssue(db, user, id, await readJson(request), new URL(request.url).origin);
    return NextResponse.json(built);
  } catch (err) {
    return failure(err, "certificate-requests/[id]/preview POST");
  }
}
