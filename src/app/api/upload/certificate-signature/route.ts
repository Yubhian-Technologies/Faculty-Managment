export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authenticate, failure } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { storeUpload } from "@/lib/certifications/uploadFile";

// The signature image printed on certificates (Principal / College Admin / VP set them up).
export async function POST(request: Request) {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const { url } = await storeUpload(request, `certificate-signatures/${session.collegeId}`, ["png", "jpg"], 512 * 1024);
    return NextResponse.json({ url });
  } catch (err) {
    return failure(err, "upload/certificate-signature POST");
  }
}
