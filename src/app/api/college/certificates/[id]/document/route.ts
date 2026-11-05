export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { readIssuedDocument } from "@/lib/certifications/configured";

// The issued certificate, exactly as it was issued (the frozen page) - the browser turns it into the PDF.
// For the student it was issued to, whoever issued it, and the register roles.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const { issued, html } = await readIssuedDocument(db, user, id);
    return NextResponse.json({ certificate: issued, html, url: issued.uploadedPdf ? issued.documentUrl : null });
  } catch (err) {
    return failure(err, "certificates/[id]/document GET");
  }
}
