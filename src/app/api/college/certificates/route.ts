export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { authenticate, failure } from "@/lib/certifications/http";
import { listRegister, REGISTER_ROLES } from "@/lib/certifications/configured";

// The Certificate Register: every certificate the college issued (configured types), newest first.
export async function GET() {
  try {
    const session = await authenticate(...REGISTER_ROLES);
    const certificates = await listRegister(getAdminDb(), session.collegeId);
    return NextResponse.json({ certificates });
  } catch (err) {
    return failure(err, "certificates GET");
  }
}
