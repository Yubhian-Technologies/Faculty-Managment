export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { templatesCol } from "@/lib/certifications/store";
import { cleanTemplate } from "@/lib/certifications/typeConfig";
import { CertificationError } from "@/lib/certifications/types";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

export async function POST(request: Request) {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const clean = cleanTemplate(await readJson(request));
    if (!clean.ok) throw new CertificationError("INVALID", clean.error, 400);
    const ref = templatesCol(db, session.collegeId).doc();
    const data = { ...clean.value, updatedAt: new Date().toISOString() };
    await ref.set(data);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: ref.id, details: { what: "template added", name: data.name },
    });
    return NextResponse.json({ template: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    return failure(err, "certificate-config/templates POST");
  }
}
