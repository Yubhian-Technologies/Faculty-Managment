export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanCeaSettings, ceaSettingsId } from "@/lib/cea/rules";
import { CEA_READ_ROLES, CEA_SETTINGS_ROLES, CeaError, ceaErrorResponse, ceaRefs, loadAllCeaSettings } from "@/lib/cea/server";
import type { CeaSettings } from "@/types";

// CEA settings per course + regulation (Exam Cell > Mid Configuration > CEA): on / off, marks per unit, the
// weight in internal marks, assessment types and a with-Mid CEA paper's time. GET also lists the catalog
// courses with their regulations for the picker.

export async function GET() {
  try {
    const session = await requireCollegeMember(...CEA_READ_ROLES);
    const db = getAdminDb();
    const [settings, catalog] = await Promise.all([loadAllCeaSettings(db, session.collegeId), ceaRefs(db, session.collegeId).college.collection("courseCatalog").get()]);
    const courses = catalog.docs.map((d) => ({
      courseKey: d.id, courseName: String(d.get("name") ?? d.id),
      regulations: [...new Set(((d.get("regulations") as string[] | undefined) ?? []).map((r) => String(r).trim().toUpperCase()).filter(Boolean))].sort(),
    })).sort((a, b) => a.courseName.localeCompare(b.courseName));
    return NextResponse.json({ settings: settings.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation)), courses, canEdit: CEA_SETTINGS_ROLES.includes(session.role) });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/settings GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...CEA_SETTINGS_ROLES);
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { settings?: unknown; version?: unknown };
    const clean = cleanCeaSettings(body.settings);
    const cat = await ceaRefs(db, session.collegeId).college.collection("courseCatalog").doc(clean.courseKey).get();
    const regs = ((cat.get("regulations") as string[] | undefined) ?? []).map((r) => String(r).trim().toUpperCase());
    if (!cat.exists || !regs.includes(clean.regulation)) throw new CeaError(`${clean.regulation} is not a regulation of ${clean.courseName} in the Course Catalog`);
    const id = ceaSettingsId(clean.courseKey, clean.regulation);
    const ref = ceaRefs(db, session.collegeId).settings.doc(id);
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const version = snap.exists ? (snap.data() as CeaSettings).version : 0;
      if (Number(body.version ?? -1) !== version) throw new CeaError("Someone else changed these settings - reload and try again", 409);
      const next: CeaSettings = { id, ...clean, version: version + 1, updatedAt: new Date().toISOString(), updatedByName: session.email };
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "CEA_SETTINGS_SAVED", performedBy: session.uid, performedByName: session.email, targetId: id, details: { ...clean } });
    return NextResponse.json({ settings: saved });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/settings PUT]");
  }
}
