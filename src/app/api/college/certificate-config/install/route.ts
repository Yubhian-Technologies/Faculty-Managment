export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { installStarterCatalog, resetToStarter } from "@/lib/certifications/store";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// Adds the starter certificates (and their templates) the college doesn't have yet - never overwrites one.
// With { reset: typeId }: puts that starter certificate back to the starter version (only while unused).
export async function POST(request: Request) {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await request.json().catch(() => ({}))) as { reset?: unknown };
    if (typeof body.reset === "string" && body.reset) {
      try {
        await resetToStarter(db, session.collegeId, body.reset, user.name);
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        if (code === "IN_USE") return NextResponse.json({ error: "Requests already use this certificate - edit it instead" }, { status: 409 });
        if (code === "NOT_STARTER") return NextResponse.json({ error: "This is not a starter certificate" }, { status: 400 });
        throw e;
      }
      await writeAuditLogSafe(db, session.collegeId, {
        action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: body.reset, details: { what: "reset to starter" },
      });
      return NextResponse.json({ ok: true });
    }
    const added = await installStarterCatalog(db, session.collegeId, user.name);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: "catalog", details: { what: "starter catalogue installed", ...added },
    });
    return NextResponse.json({ added });
  } catch (err) {
    return failure(err, "certificate-config/install POST");
  }
}
