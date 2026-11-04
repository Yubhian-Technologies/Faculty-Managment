export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES, typeInUse } from "@/lib/certifications/configured";
import { saveType } from "@/lib/certifications/configRoutes";
import { typesCol } from "@/lib/certifications/store";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// Editing a type changes only requests made after it: one already applied for keeps the approvers, issuer,
// template and fee it was made with.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const type = await saveType(db, user, await readJson(request), id);
    return NextResponse.json({ type });
  } catch (err) {
    return failure(err, "certificate-config/types/[id] PATCH");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const ref = typesCol(db, session.collegeId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Certificate type not found" }, { status: 404 });
    if (await typeInUse(db, session.collegeId, id)) {
      return NextResponse.json({ error: "Students have already applied for this certificate - switch it off instead, so its records stay complete" }, { status: 409 });
    }
    await ref.delete();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: id, details: { what: "type deleted", name: snap.get("name") },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err, "certificate-config/types/[id] DELETE");
  }
}
