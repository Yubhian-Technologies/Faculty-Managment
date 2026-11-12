export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { cleanCeaPlan, midOf, planChanges } from "@/lib/cea/rules";
import { CEA_READ_ROLES, CeaError, ceaContext, ceaErrorResponse, ceaRefs, printedMids } from "@/lib/cea/server";
import type { CeaPlan } from "@/types";

// A subject's CEA plan. GET: anyone who reads a syllabus. PUT { version, units: [{ unit, typeId, when }] }: the HOD
// of the subject's Subject Department, or the Exam Cell. Needs CEA switched on for the subject's course +
// regulation and a FROZEN syllabus (its units are what gets planned). Once a Mid's paper is printed, which unit
// goes with that Mid is fixed; a change before that reaches a started paper set as a pattern change (the setter
// moves to it, as for any Exam Cell change).

type Ctx = { params: Promise<{ subjectId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember(...CEA_READ_ROLES);
    const { subjectId } = await params;
    const db = getAdminDb();
    const [c, mid] = await Promise.all([ceaContext(db, session, subjectId), loadMidSettings(db, session.collegeId)]);
    return NextResponse.json({
      subject: { id: c.subject.id, code: c.subject.code, name: c.subject.name, courseName: c.subject.courseName ?? "", regulation: c.subject.regulation ?? "" },
      settings: c.settings, syllabusStatus: c.syllabusStatus, units: c.units, plan: c.plan, canEdit: c.canEdit && !!c.settings, midCount: Math.max(mid.midCount, 1), owners: c.owners,
    });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/plans/[subjectId] GET]");
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("HOD", "EXAM_CELL", "SUPER_ADMIN");
    const { subjectId } = await params;
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { version?: unknown; units?: unknown };
    const [c, mid] = await Promise.all([ceaContext(db, session, subjectId), loadMidSettings(db, session.collegeId)]);
    if (!c.canEdit) throw new CeaError("Only the HOD of the subject's Subject Department (or the Exam Cell) plans its CIE", 403);
    if (!c.settings) throw new CeaError("CIE isn't switched on for this subject's course and regulation", 409);
    if (c.syllabusStatus !== "FROZEN") throw new CeaError("The subject's syllabus must be frozen by Academics first - its units are what you plan", 409);
    const units = cleanCeaPlan(body.units, c.units, c.settings, Math.max(mid.midCount, 1));
    // A Mid whose paper is already printed keeps its CEA unit (the students wrote that paper).
    const printed = await printedMids(db, session.collegeId, subjectId);
    for (const n of printed) {
      const was = c.plan?.units.find((u) => midOf(u.when) === n)?.unit ?? null;
      const now = units.find((u) => midOf(u.when) === n)?.unit ?? null;
      if (was !== now) throw new CeaError(`Mid ${n}'s paper is already printed${was ? ` with Unit ${was}'s CIE paper` : " without a CIE paper"} - that can't change now`, 409);
    }
    const typeLabel = (id: string) => c.settings!.types.find((t) => t.id === id)?.label ?? id;
    const ref = ceaRefs(db, session.collegeId).plans.doc(subjectId);
    const at = new Date().toISOString();
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as CeaPlan) : null;
      if (Number(body.version ?? -1) !== (cur?.version ?? 0)) throw new CeaError("Someone else changed this plan - reload and try again", 409);
      const change = planChanges(cur?.units ?? [], units, typeLabel);
      const next: CeaPlan = {
        subjectId, subjectCode: c.subject.code, subjectName: c.subject.name, courseKey: c.courseKey, regulation: c.settings!.regulation,
        units, version: (cur?.version ?? 0) + 1, updatedAt: at, updatedByName: session.email,
        history: [...(cur?.history ?? []), { at, byName: session.email, change }].slice(-100),
      };
      tx.set(ref, next);
      return { next, change };
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "CEA_PLAN_SAVED", performedBy: session.uid, performedByName: session.email, targetId: subjectId, details: { change: saved.change } });
    return NextResponse.json({ plan: saved.next });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/plans/[subjectId] PUT]");
  }
}
