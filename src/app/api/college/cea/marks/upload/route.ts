export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { istDateKey } from "@/lib/attendance/istTime";
import { ceaSheetId, isEntered } from "@/lib/cea/marks";
import { assertCeaEditor, ceaMarksCol, ceaSectionContext, draftSheet, internalSubmitted } from "@/lib/cea/marksServer";
import { planCieUpload, type UploadRow, type UploadUnit } from "@/lib/cea/upload";
import { CeaError, ceaErrorResponse } from "@/lib/cea/server";
import type { CeaMarksSheet } from "@/types";

// CIE marks for a whole section at once (every planned unit) - the faculty member who teaches it, or the Exam Cell.
// GET ?assignmentId=  -> the units and students (with marks so far) for the downloaded template.
// POST { assignmentId, rows: [{ roll, marks: { "<unit>": value } }], heldOn: { "<unit>": date }, apply }
//   apply false: the check only (nothing saved). apply true: refused while the check has any problem; otherwise every
//   unit with marks in the file is saved as a DRAFT (submitted units are left alone) - the faculty member checks it
//   and presses Submit, which is what feeds internal marks.

const ROLES = ["PANEL_MEMBER", "EXAM_CELL", "SUPER_ADMIN"] as const;

async function load(db: FirebaseFirestore.Firestore, collegeId: string, session: { uid: string; role: string }, assignmentId: string) {
  const ctx = await ceaSectionContext(db, collegeId, assignmentId);
  await assertCeaEditor(db, collegeId, session, ctx.a);
  const units = [...ctx.ps.plan.units].sort((x, y) => x.unit - y.unit);
  const snaps = await db.getAll(...units.map((u) => ceaMarksCol(db, collegeId).doc(ceaSheetId(assignmentId, u.unit))));
  const sheets = new Map(snaps.filter((s) => s.exists).map((s) => [(s.data() as CeaMarksSheet).unit, s.data() as CeaMarksSheet]));
  return { ctx, units, sheets };
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const assignmentId = new URL(request.url).searchParams.get("assignmentId") ?? "";
    if (!assignmentId) throw new CeaError("Pick a section");
    const db = getAdminDb();
    const { ctx, units, sheets } = await load(db, session.collegeId, session, assignmentId);
    const marksOf = (studentId: string) => Object.fromEntries(units.map((u) => {
      const e = sheets.get(u.unit)?.entries.find((x) => x.studentId === studentId);
      return [String(u.unit), !e || !isEntered(e) ? "" : e.absent ? "AB" : e.marks];
    }));
    return NextResponse.json({
      subjectCode: ctx.a.subjectCode, subjectName: ctx.a.subjectName, department: ctx.a.department, section: ctx.sectionName,
      unitMarks: ctx.ps.settings.unitMarks,
      units: units.map((u) => ({ unit: u.unit, title: u.title, when: u.when, status: sheets.get(u.unit)?.status ?? null, heldOn: sheets.get(u.unit)?.heldOn ?? null })),
      students: ctx.roster.map((s) => ({ rollNumber: s.rollNumber, name: s.name, marks: marksOf(s.id) })),
    });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks/upload GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { assignmentId?: unknown; rows?: unknown; heldOn?: unknown; apply?: unknown };
    if (typeof body.assignmentId !== "string" || !body.assignmentId) throw new CeaError("Pick a section");
    const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 1000).map((r) => {
      const o = (r ?? {}) as { roll?: unknown; marks?: unknown };
      return { roll: String(o.roll ?? ""), marks: (o.marks && typeof o.marks === "object" ? o.marks : {}) as UploadRow["marks"] };
    });
    const heldOn = (body.heldOn && typeof body.heldOn === "object" ? body.heldOn : {}) as Record<string, unknown>;
    const db = getAdminDb();
    const { ctx, units, sheets } = await load(db, session.collegeId, session, body.assignmentId);
    if (await internalSubmitted(db, session.collegeId, body.assignmentId)) {
      throw new CeaError("The section's internal marks are already submitted - CIE marks can't change", 409);
    }
    const uploadUnits: UploadUnit[] = units.map((u) => ({
      unit: u.unit, when: u.when, unitMarks: ctx.ps.settings.unitMarks, status: sheets.get(u.unit)?.status ?? null, heldOn: sheets.get(u.unit)?.heldOn ?? null,
    }));
    const plan = planCieUpload({
      units: uploadUnits, students: ctx.roster.map((s) => ({ studentId: s.id, rollNumber: s.rollNumber, name: s.name })),
      rows, heldOn, today: istDateKey(new Date()),
    });
    const problems = [...plan.errors, ...(plan.unknownRolls.length ? [`Not students of this section: ${plan.unknownRolls.join(", ")}`] : [])];
    const summary = { units: plan.changes.map((c) => ({ unit: c.unit, marks: c.values.length })), skippedSubmitted: plan.skippedSubmitted, marksGiven: plan.marksGiven };
    if (body.apply !== true || problems.length) {
      return NextResponse.json({ ok: problems.length === 0, problems, ...summary }, { status: body.apply === true && problems.length ? 400 : 200 });
    }

    const at = new Date().toISOString();
    const byName = session.email;
    for (const change of plan.changes) {
      const ref = ceaMarksCol(db, session.collegeId).doc(ceaSheetId(body.assignmentId, change.unit));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? (snap.data() as CeaMarksSheet) : null;
        if (cur?.status === "SUBMITTED") return; // submitted meanwhile - left alone
        const base = draftSheet(ctx, change.unit, cur, byName, at);
        const given = new Map(change.values.map((v) => [v.studentId, v]));
        const entries = base.entries.map((e) => {
          const v = given.get(e.studentId);
          if (!v) return e;
          return v.absent ? { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: 0, absent: true as const }
            : { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, marks: v.marks };
        });
        tx.set(ref, {
          ...base, entries, enteredCount: entries.filter(isEntered).length, ...(change.heldOn ? { heldOn: change.heldOn } : {}),
          status: "DRAFT", rev: base.rev + 1, updatedAt: at, updatedByName: byName,
        } satisfies CeaMarksSheet);
      });
    }
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CEA_MARKS_UPLOAD", performedBy: session.uid, performedByName: byName, targetId: body.assignmentId,
      details: { subjectCode: ctx.a.subjectCode, section: ctx.sectionName, units: summary.units, byRole: session.role },
    });
    return NextResponse.json({ ok: true, problems: [], ...summary });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks/upload POST]");
  }
}
