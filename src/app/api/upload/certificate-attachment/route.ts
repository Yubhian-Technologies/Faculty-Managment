export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticate, failure } from "@/lib/certifications/http";
import { storeUpload } from "@/lib/certifications/uploadFile";

// A document a student attaches to a certificate request (an affidavit, a fee receipt). Stored in the student's
// own folder - the request only accepts files from there.
export async function POST(request: Request) {
  try {
    const session = await authenticate("STUDENT");
    const { url } = await storeUpload(request, `certificate-attachments/${session.collegeId}/${session.uid}`, ["pdf", "png", "jpg"], 5 * 1024 * 1024);
    return NextResponse.json({ url });
  } catch (err) {
    return failure(err, "upload/certificate-attachment POST");
  }
}
