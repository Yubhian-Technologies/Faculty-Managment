export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify, notifyRole } from "@/lib/notify";
import { assertOwner, assertReader, midMarksSheetsCol, SHEET_ID_RE, stateOfSheet } from "@/lib/midMarks/server";
import { applyEntries, completeCount, MidMarksError, notAttemptedFilled } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import { cieForMidSheet } from "@/lib/midMarks/cie";
import type { MidMarksHistoryAction, MidMarksSheet } from "@/types/midMarks";

// One section's Mid marks sheet. DRAFT -> SUBMITTED (with the Exam Cell) -> FROZEN (final).
// GET: its faculty, an HOD of its department, the Exam Cell, Principal / VP.
// PATCH { rev, ... } by the faculty member it belongs to:
//   entries?            save a draft (entry open, before the last date or reopened by the Exam Cell)
//   action "SUBMIT"     every student complete -> SUBMITTED; the Exam Cell is told
//   action "WITHDRAW"   SUBMITTED (not frozen) -> DRAFT
//   action "REQUEST_CHANGE", reason   SUBMITTED / FROZEN: asks the Exam Cell to reopen it
// PATCH { rev, ... } by the Exam Cell (or Super Admin):
//   action "FREEZE"     SUBMITTED -> FROZEN (final; the faculty can only request a change)
//   action "REOPEN", reason           SUBMITTED / FROZEN -> DRAFT, editable past the last date until the next submit
//   action "DECIDE", approve, remarks a pending change request: approve = REOPEN; reject keeps the marks as they are
// The with-Mid CIE unit is entered on CIE Marks; GET returns it (cie) to show beside the Mid marks. The faculty is told
// of every Exam Cell step.

const EXAM_CELL = ["EXAM_CELL", "SUPER_ADMIN"];
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(_request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { sheetId } = await params;
    if (!SHEET_ID_RE.test(sheetId)) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const db = getAdminDb();
    const sheet = (await midMarksSheetsCol(db, session.collegeId).doc(sheetId).get()).data() as MidMarksSheet | undefined;
    if (!sheet) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    await assertReader(db, session.collegeId, session, sheet);
    const [state, cie] = await Promise.all([stateOfSheet(db, session.collegeId, sheet).catch(() => null), cieForMidSheet(db, session.collegeId, sheet).catch(() => null)]);
    return NextResponse.json({ sheet, state, cie });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/[sheetId] GET]");
  }
}

async function facultyUidOf(db: FirebaseFirestore.Firestore, collegeId: string, facultyId: string): Promise<string | undefined> {
  return (await db.collection("colleges").doc(collegeId).collection("facultyMembers").doc(facultyId).get()).get("userUid") as string | undefined;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "EXAM_CELL", "SUPER_ADMIN");
    const { sheetId } = await params;
    if (!SHEET_ID_RE.test(sheetId)) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const body = (await readJsonBody(request)) as { rev?: unknown; entries?: unknown; action?: unknown; reason?: unknown; approve?: unknown; remarks?: unknown };
    const db = getAdminDb();
    const c = session.collegeId;
    const ref = midMarksSheetsCol(db, c).doc(sheetId);
    const first = (await ref.get()).data() as MidMarksSheet | undefined;
    if (!first) throw new MidMarksError("Mid marks sheet not found. It may have been deleted.", 404);
    const me = (await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    const byName = me?.name ?? session.email;
    const at = new Date().toISOString();
    const action = typeof body.action === "string" ? body.action : "";
    const label = `Mid-${first.midNumber} marks of ${first.subjectName}, ${first.sectionName}`;
    const step = (cur: MidMarksSheet, a: MidMarksHistoryAction, reason?: string) => [...(cur.history ?? []), { at, byName, action: a, ...(reason ? { reason } : {}) }].slice(-30);

    /** Runs one change in a transaction after checking the sheet wasn't changed meanwhile. */
    const change = (fn: (cur: MidMarksSheet) => MidMarksSheet) => db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as MidMarksSheet;
      if (Number(body.rev ?? -1) !== cur.rev) throw new MidMarksError("This sheet changed since you opened it. Reload and try again.", 409);
      const next = fn(cur);
      tx.set(ref, { ...next, rev: cur.rev + 1, updatedAt: at, updatedByName: byName });
      return { ...next, rev: cur.rev + 1, updatedAt: at, updatedByName: byName } as MidMarksSheet;
    });
    const reopened = (cur: MidMarksSheet): MidMarksSheet => {
      const next: MidMarksSheet = { ...cur, status: "DRAFT", editGrant: { at, byName } };
      delete next.submittedAt; delete next.frozenAt; delete next.frozenByName;
      return next;
    };

    // ---- Exam Cell ----
    if (["FREEZE", "REOPEN", "DECIDE"].includes(action)) {
      if (!EXAM_CELL.includes(session.role)) throw new MidMarksError("Only the Exam Cell can do this.", 403);
      const facultyUid = await facultyUidOf(db, c, first.facultyId);
      let saved: MidMarksSheet;
      let message = "";
      if (action === "FREEZE") {
        saved = await change((cur) => {
          if (cur.status !== "SUBMITTED") throw new MidMarksError(cur.status === "FROZEN" ? "Already frozen." : "Only submitted marks can be frozen.", 409);
          return { ...cur, status: "FROZEN", frozenAt: at, frozenByName: byName, history: step(cur, "FROZEN") };
        });
        message = `The Exam Cell froze your ${label}. To change them, send a change request.`;
      } else if (action === "REOPEN") {
        const reason = text(body.reason);
        if (!reason) throw new MidMarksError("Enter the reason for reopening.");
        saved = await change((cur) => {
          if (cur.status === "DRAFT") throw new MidMarksError("This sheet is already open for changes.", 409);
          const next = reopened(cur);
          if (cur.changeRequest?.status === "PENDING") next.changeRequest = { ...cur.changeRequest, status: "APPROVED", decidedAt: at, decidedByName: byName, remarks: reason };
          return { ...next, history: step(cur, "REOPENED", reason) };
        });
        message = `The Exam Cell reopened your ${label}: ${reason}`;
      } else {
        const approve = body.approve === true;
        const remarks = text(body.remarks);
        if (!approve && !remarks) throw new MidMarksError("Enter the reason for rejecting the request.");
        saved = await change((cur) => {
          if (cur.changeRequest?.status !== "PENDING") throw new MidMarksError("There is no change request waiting.", 409);
          const decided = { ...cur.changeRequest, status: approve ? "APPROVED" as const : "REJECTED" as const, decidedAt: at, decidedByName: byName, ...(remarks ? { remarks } : {}) };
          if (!approve) return { ...cur, changeRequest: decided, history: step(cur, "CHANGE_REJECTED", remarks) };
          return { ...reopened(cur), changeRequest: decided, history: step(cur, "CHANGE_APPROVED", remarks || undefined) };
        });
        message = approve
          ? `The Exam Cell approved your change request for ${label}. Make the changes and submit again.${remarks ? ` ${remarks}` : ""}`
          : `The Exam Cell rejected your change request for ${label}: ${remarks}`;
      }
      if (facultyUid) await notify(db, c, facultyUid, "GENERAL", `Mid-${saved.midNumber} Marks`, message, `/panel/mid-marks/${saved.assignmentId}/${saved.midNumber}`).catch(() => undefined);
      await writeAuditLogSafe(db, c, { action: `MID_MARKS_SHEET_${action === "DECIDE" ? (body.approve === true ? "CHANGE_APPROVED" : "CHANGE_REJECTED") : action === "FREEZE" ? "FROZEN" : "REOPENED"}`, performedBy: session.uid, performedByName: byName, targetId: sheetId, details: { subjectCode: saved.subjectCode, section: saved.sectionName, midNumber: saved.midNumber } });
      return NextResponse.json({ sheet: saved, state: await stateOfSheet(db, c, saved).catch(() => null) });
    }

    // ---- Faculty ----
    await assertOwner(db, c, session.uid, first.facultyId);
    const state = await stateOfSheet(db, c, first);
    const link = "/exam-cell/mid-marks";

    if (action === "WITHDRAW") {
      if (!state.canWithdraw) throw new MidMarksError(state.reason || "This sheet can't be withdrawn now.", 409);
      const saved = await change((cur) => {
        if (cur.status !== "SUBMITTED") throw new MidMarksError("Only submitted marks that aren't frozen can be withdrawn.", 409);
        const next: MidMarksSheet = { ...cur, status: "DRAFT", history: step(cur, "WITHDRAWN") };
        delete next.submittedAt;
        return next;
      });
      return NextResponse.json({ sheet: saved, state: await stateOfSheet(db, c, saved) });
    }

    if (action === "REQUEST_CHANGE") {
      const reason = text(body.reason, 500);
      if (!reason) throw new MidMarksError("Enter what needs to change and why.");
      if (!state.canRequestChange) throw new MidMarksError(state.reason || "A change request can't be sent now.", 409);
      const saved = await change((cur) => {
        if (cur.status === "DRAFT") throw new MidMarksError("This sheet is open - change the marks directly.", 409);
        if (cur.changeRequest?.status === "PENDING") throw new MidMarksError("A change request is already waiting for the Exam Cell.", 409);
        return { ...cur, changeRequest: { status: "PENDING", reason, at, byName }, history: step(cur, "CHANGE_REQUESTED", reason) };
      });
      await notifyRole(db, c, "EXAM_CELL", "GENERAL", "Mid Marks Change Request", `${byName} asks to change the ${label}: ${reason}`, `/exam-cell/mid-marks/sheets/${sheetId}`).catch(() => undefined);
      await writeAuditLogSafe(db, c, { action: "MID_MARKS_CHANGE_REQUESTED", performedBy: session.uid, performedByName: byName, targetId: sheetId, details: { reason } });
      return NextResponse.json({ sheet: saved, state: await stateOfSheet(db, c, saved) });
    }

    if (!state.canEdit) throw new MidMarksError(state.reason, 409);
    const submit = action === "SUBMIT";
    const saved = await change((cur) => {
      if (cur.status !== "DRAFT") throw new MidMarksError("Already submitted. Withdraw it, or send a change request once it is frozen.", 409);
      const applied = body.entries ? applyEntries(cur.sheet, cur.entries, body.entries) : cur.entries;
      const done = completeCount(cur.sheet, applied);
      if (submit && done < applied.length) throw new MidMarksError(`${applied.length - done} student(s) have no marks yet. Enter at least one mark (an empty box counts as not attempted) or mark the student AB.`);
      // Submitted: every empty box of a student with marks is stored as "-" (not attempted).
      const entries = submit ? notAttemptedFilled(cur.sheet, applied) : applied;
      const next: MidMarksSheet = { ...cur, entries, completeCount: done, totalStudents: entries.length };
      if (!submit) return next;
      const out: MidMarksSheet = { ...next, status: "SUBMITTED", submittedAt: at, history: step(cur, "SUBMITTED") };
      delete out.editGrant;
      return out;
    });
    if (submit) {
      await notifyRole(db, c, "EXAM_CELL", "GENERAL", "Mid Marks Submitted", `${byName} submitted the ${label}. Check and freeze them.`, link).catch(() => undefined);
      await writeAuditLogSafe(db, c, {
        action: "MID_MARKS_SHEET_SUBMITTED", performedBy: session.uid, performedByName: byName, targetId: sheetId,
        details: { subjectCode: saved.subjectCode, section: saved.sectionName, midNumber: saved.midNumber },
      });
    }
    return NextResponse.json({ sheet: saved, state: submit ? await stateOfSheet(db, c, saved) : state });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/[sheetId] PATCH]");
  }
}
