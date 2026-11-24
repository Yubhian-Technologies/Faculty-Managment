export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { authorizedSection } from "@/lib/students/sectionInchargeAuth";
import { LAB_BATCH_SETTINGS, labBatchSettingId } from "@/lib/students/labBatchMode";
import { cleanPeriodChoices } from "@/lib/students/labPeriodBatches";
import { sectionLabPeriods } from "@/lib/students/sectionLabsServer";

// PUT { sectionId, choices: { [periodKey]: { [subjectId]: batch | null } } }: the class in-charge (or HOD) says
// which batch goes to which lab in periods where two labs of the section run side by side. Only the periods sent
// change; every lab of such a period is written together (SectionLabBatchSetting.batchByPeriod).

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const body = (await readJsonBody(request)) as { sectionId?: unknown; choices?: unknown };
    const sectionId = typeof body.sectionId === "string" ? body.sectionId.trim() : "";
    if (!sectionId) return NextResponse.json({ error: "Select a section." }, { status: 400 });
    const auth = await authorizedSection(session, sectionId);
    if ("error" in auth) return auth.error;

    const { periods, batches } = await sectionLabPeriods(session.collegeId, auth.section);
    const cleaned = cleanPeriodChoices(body.choices, periods, batches);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const db = getAdminDb();
    const col = db.collection("colleges").doc(session.collegeId).collection(LAB_BATCH_SETTINGS);
    const bySubject = new Map<string, Record<string, string | null>>();
    for (const [key, row] of Object.entries(cleaned.choices)) {
      for (const [subjectId, batch] of Object.entries(row)) bySubject.set(subjectId, { ...(bySubject.get(subjectId) ?? {}), [key]: batch });
    }
    const now = new Date();
    await db.runTransaction(async (tx) => {
      const refs = [...bySubject.keys()].map((subjectId) => col.doc(labBatchSettingId(sectionId, subjectId)));
      const snaps = refs.length ? await tx.getAll(...refs) : [];
      snaps.forEach((snap, i) => {
        const subjectId = [...bySubject.keys()][i];
        const changes = bySubject.get(subjectId)!;
        if (snap.exists) {
          const update: Record<string, unknown> = { updatedBy: session.uid, updatedAt: now };
          for (const [key, batch] of Object.entries(changes)) update[`batchByPeriod.${key}`] = batch ?? FieldValue.delete();
          tx.update(refs[i], update);
        } else {
          const batchByPeriod = Object.fromEntries(Object.entries(changes).filter(([, b]) => !!b)) as Record<string, string>;
          if (Object.keys(batchByPeriod).length === 0) return;
          // No decision for this lab yet: batch-wise with no faculty batches = behaves as scheduled elsewhere.
          tx.set(refs[i], { collegeId: session.collegeId, sectionId, subjectId, batchWise: true, batchByPeriod, updatedBy: session.uid, updatedAt: now });
        }
      });
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "LAB_PERIOD_BATCHES_SET",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: sectionId,
      details: { sectionId, choices: cleaned.choices },
    });
    const after = await sectionLabPeriods(session.collegeId, auth.section);
    return NextResponse.json({ periods: after.periods });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/section-lab-batch-settings/periods PUT]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
