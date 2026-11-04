export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { authenticate, failure } from "@/lib/certifications/http";
import { loadSettings, loadTemplates, loadTypes } from "@/lib/certifications/store";
import { SETUP_READ_ROLES } from "@/lib/certifications/configRoutes";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";

// Certificate Setup: the college's certificate types, templates and signatures, plus which types already have
// requests (those can be switched off, not deleted).
export async function GET() {
  try {
    const session = await authenticate(...SETUP_READ_ROLES);
    const db = getAdminDb();
    const [types, templates, settings, requests] = await Promise.all([
      loadTypes(db, session.collegeId), loadTemplates(db, session.collegeId), loadSettings(db, session.collegeId),
      CERTIFICATE_REQUESTS_COL(db, session.collegeId).select("certificateTypeId").get(),
    ]);
    const used = new Set(requests.docs.map((d) => d.get("certificateTypeId") as string | undefined).filter(Boolean));
    return NextResponse.json({ types: types.map((t) => ({ ...t, inUse: used.has(t.id) })), templates, settings });
  } catch (err) {
    return failure(err, "certificate-config GET");
  }
}
