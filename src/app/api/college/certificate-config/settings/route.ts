export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { settingsDoc } from "@/lib/certifications/store";
import { cleanSignatures } from "@/lib/certifications/configRoutes";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// The signatures printed on certificates (a type picks one; the first is the default).
export async function PUT(request: Request) {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await readJson(request)) as { signatures?: unknown };
    const signatures = cleanSignatures(body.signatures, session.collegeId);
    await settingsDoc(db, session.collegeId).set({ signatures, updatedAt: new Date().toISOString(), updatedByName: user.name }, { merge: true });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: "signatures", details: { what: "signatures saved", count: signatures.length },
    });
    return NextResponse.json({ settings: { signatures } });
  } catch (err) {
    return failure(err, "certificate-config/settings PUT");
  }
}
