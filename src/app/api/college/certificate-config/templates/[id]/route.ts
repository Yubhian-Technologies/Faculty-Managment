export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { templatesCol, typesCol } from "@/lib/certifications/store";
import { cleanTemplate } from "@/lib/certifications/typeConfig";
import { CertificationError } from "@/lib/certifications/types";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// A template edit applies to certificates issued after it; ones already issued keep their frozen copy.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const ref = templatesCol(db, session.collegeId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const clean = cleanTemplate(await readJson(request));
    if (!clean.ok) throw new CertificationError("INVALID", clean.error, 400);
    const data = { ...clean.value, ...(snap.get("catalogKey") ? { catalogKey: snap.get("catalogKey") } : {}), updatedAt: new Date().toISOString() };
    await ref.set(data);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: id, details: { what: "template updated", name: data.name },
    });
    return NextResponse.json({ template: { id, ...data } });
  } catch (err) {
    return failure(err, "certificate-config/templates/[id] PATCH");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const ref = templatesCol(db, session.collegeId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const users = await typesCol(db, session.collegeId).where("templateId", "==", id).get();
    if (!users.empty) {
      return NextResponse.json({ error: `Used by ${users.docs.map((d) => `"${d.get("name")}"`).join(", ")} - give those another template first` }, { status: 409 });
    }
    await ref.delete();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: id, details: { what: "template deleted", name: snap.get("name") },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err, "certificate-config/templates/[id] DELETE");
  }
}
