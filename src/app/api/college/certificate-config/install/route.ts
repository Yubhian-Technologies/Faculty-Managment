export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { installStarterCatalog } from "@/lib/certifications/store";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// Adds the starter certificates (and their templates) the college doesn't have yet - never overwrites one.
export async function POST() {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const added = await installStarterCatalog(db, session.collegeId, user.name);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: "catalog", details: { what: "starter catalogue installed", ...added },
    });
    return NextResponse.json({ added });
  } catch (err) {
    return failure(err, "certificate-config/install POST");
  }
}
