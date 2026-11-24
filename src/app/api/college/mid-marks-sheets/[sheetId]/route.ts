export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { assertOwner, assertReader, midMarksSheetsCol, SHEET_ID_RE, stateOfSheet } from "@/lib/midMarks/server";
import { applyEntries, completeCount, MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import type { MidMarksSheet } from "@/types/midMarks";

// One section's Mid marks sheet.
// GET: its faculty, an HOD of its department, the Exam Cell, Principal / VP.
// PATCH { rev, entries?, action?: "SUBMIT" } - the faculty member it belongs to, while entry is open and before the
//   last date: saves a draft; SUBMIT needs every student complete (each box a mark or "-", or AB) and locks it.
// PATCH { rev, action: "REOPEN", reason } - the Exam Cell (or Super Admin): back to a draft; the faculty is told.

export async function GET(_request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { sheetId } = await params;
    if (!SHEET_ID_RE.test(sheetId)) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const db = getAdminDb();
    const sheet = (await midMarksSheetsCol(db, session.collegeId).doc(sheetId).get()).data() as MidMarksSheet | undefined;
    if (!sheet) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    await assertReader(db, session.collegeId, session, sheet);
    return NextResponse.json({ sheet, state: await stateOfSheet(db, session.collegeId, sheet).catch(() => null) });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/[sheetId] GET]");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "EXAM_CELL", "SUPER_ADMIN");
    const { sheetId } = await params;
    if (!SHEET_ID_RE.test(sheetId)) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const body = (await readJsonBody(request)) as { rev?: unknown; entries?: unknown; action?: unknown; reason?: unknown };
    const db = getAdminDb();
    const ref = midMarksSheetsCol(db, session.collegeId).doc(sheetId);
    const first = (await ref.get()).data() as MidMarksSheet | undefined;
    if (!first) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const me = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    const byName = me?.name ?? session.email;
    const at = new Date().toISOString();

    if (body.action === "REOPEN") {
      if (session.role !== "EXAM_CELL" && session.role !== "SUPER_ADMIN") throw new MidMarksError("Only the Exam Cell can reopen a submitted sheet.", 403);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
      if (!reason) throw new MidMarksError("Enter the reason for reopening.");
      const saved = await db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data() as MidMarksSheet;
        if (Number(body.rev ?? -1) !== cur.rev) throw new MidMarksError("This sheet changed since you opened it. Reload and try again.", 409);
        if (cur.status !== "SUBMITTED") throw new MidMarksError("This sheet is not submitted.", 409);
        const next: MidMarksSheet = { ...cur, status: "DRAFT", rev: cur.rev + 1, updatedAt: at, updatedByName: byName,
          history: [...(cur.history ?? []), { at, byName, action: "REOPENED" as const, reason }].slice(-20) };
        delete next.submittedAt;
        tx.set(ref, next);
        return next;
      });
      const fac = await db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(saved.facultyId).get();
      const facultyUid = fac.get("userUid") as string | undefined;
      if (facultyUid) {
        await notify(db, session.collegeId, facultyUid, "GENERAL", `Mid-${saved.midNumber} Marks Reopened`,
          `The Exam Cell reopened your Mid-${saved.midNumber} marks for ${saved.subjectName}, ${saved.sectionName}: ${reason}`, "/panel/mid-marks").catch(() => undefined);
      }
      await writeAuditLogSafe(db, session.collegeId, { action: "MID_MARKS_SHEET_REOPENED", performedBy: session.uid, performedByName: byName, targetId: sheetId, details: { reason } });
      return NextResponse.json({ sheet: saved });
    }

    await assertOwner(db, session.collegeId, session.uid, first.facultyId);
    const state = await stateOfSheet(db, session.collegeId, first);
    if (!state.canEdit) throw new MidMarksError(state.reason, 409);
    const submit = body.action === "SUBMIT";
    const saved = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as MidMarksSheet;
      if (Number(body.rev ?? -1) !== cur.rev) throw new MidMarksError("This sheet changed since you opened it. Reload and try again.", 409);
      if (cur.status === "SUBMITTED") throw new MidMarksError("Already submitted. Ask the Exam Cell to reopen it for changes.", 409);
      const entries = body.entries ? applyEntries(cur.sheet, cur.entries, body.entries) : cur.entries;
      const done = completeCount(cur.sheet, entries);
      if (submit && done < entries.length) throw new MidMarksError(`${entries.length - done} student(s) are not complete. Fill every box (a mark, or - for not attempted) or mark the student AB.`);
      const next: MidMarksSheet = {
        ...cur, entries, completeCount: done, totalStudents: entries.length, rev: cur.rev + 1, updatedAt: at, updatedByName: byName,
        ...(submit ? { status: "SUBMITTED" as const, submittedAt: at, history: [...(cur.history ?? []), { at, byName, action: "SUBMITTED" as const }].slice(-20) } : {}),
      };
      tx.set(ref, next);
      return next;
    });
    if (submit) {
      await writeAuditLogSafe(db, session.collegeId, {
        action: "MID_MARKS_SHEET_SUBMITTED", performedBy: session.uid, performedByName: byName, targetId: sheetId,
        details: { subjectCode: saved.subjectCode, section: saved.sectionName, midNumber: saved.midNumber },
      });
    }
    return NextResponse.json({ sheet: saved, state });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/[sheetId] PATCH]");
  }
}
