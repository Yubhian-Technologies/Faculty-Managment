export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { applyCeaEntries, isEntered } from "@/lib/cea/marks";
import { ceaMarksCol, ceaQuestionSheet, internalSubmitted, syncCeaIntoInternal } from "@/lib/cea/marksServer";
import { midOf } from "@/lib/cea/rules";
import { CeaError, ceaErrorResponse } from "@/lib/cea/server";
import { editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import type { CeaMarksSheet } from "@/types";

// The faculty member's own CEA sheet: { rev, entries?, heldOn?, action?: "SUBMIT" | "REOPEN" }.
// Saved as a draft; SUBMIT needs every student entered (Absent counts) and, for an in-class unit, the date it was
// held - then the section's internal-marks CEA component is updated. REOPEN puts it back to a draft. Neither is
// allowed once the section's internal marks are submitted.

/** Read a sheet: its faculty member, an HOD of its department, the Exam Cell, Principal / VP. */
export async function GET(_request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { sheetId } = await params;
    if (!/^[A-Za-z0-9_-]{1,200}__U\d{1,2}$/.test(sheetId)) throw new CeaError("Not found", 404);
    const db = getAdminDb();
    const sheet = (await ceaMarksCol(db, session.collegeId).doc(sheetId).get()).data() as CeaMarksSheet | undefined;
    if (!sheet) throw new CeaError("Not started yet", 404);
    if (session.role === "PANEL_MEMBER" && sheet.facultyId !== (await resolveFacultyMemberId(db, session.collegeId, session.uid))) throw new CeaError("This isn't your section", 403);
    if (session.role === "HOD" && !editableDepartmentNames(await getHodDepartmentScope(db, session.collegeId, session.uid)).includes(sheet.department)) throw new CeaError("Not your department", 403);
    return NextResponse.json({ sheet });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks/[sheetId] GET]");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const { sheetId } = await params;
    if (!/^[A-Za-z0-9_-]{1,200}__U\d{1,2}$/.test(sheetId)) throw new CeaError("Not found", 404);
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { rev?: unknown; entries?: unknown; heldOn?: unknown; action?: unknown };
    const ref = ceaMarksCol(db, session.collegeId).doc(sheetId);
    const first = (await ref.get()).data() as CeaMarksSheet | undefined;
    if (!first) throw new CeaError("Not found", 404);
    if (first.facultyId !== (await resolveFacultyMemberId(db, session.collegeId, session.uid))) throw new CeaError("This isn't your section", 403);
    if (await internalSubmitted(db, session.collegeId, first.assignmentId)) throw new CeaError("The section's internal marks are already submitted - CEA marks can't change", 409);
    const mid = midOf(first.when);
    const qSheet = mid && body.entries ? await ceaQuestionSheet(db, session.collegeId, { subjectId: first.subjectId, department: first.department, year: first.year, midNumber: mid }) : null;
    const at = new Date().toISOString();

    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.data() as CeaMarksSheet;
      if (Number(body.rev ?? -1) !== cur.rev) throw new CeaError("This sheet changed since you opened it - reload and try again", 409);
      if (body.action === "REOPEN") {
        if (cur.status !== "SUBMITTED") throw new CeaError("Not submitted");
        const next = { ...cur, status: "DRAFT" as const, rev: cur.rev + 1, updatedAt: at, updatedByName: session.email };
        delete next.submittedAt;
        tx.set(ref, next);
        return next;
      }
      if (cur.status === "SUBMITTED") throw new CeaError("Already submitted - reopen it to change marks", 409);
      const entries = body.entries ? applyCeaEntries(cur.entries, body.entries, cur.unitMarks, qSheet) : cur.entries;
      const heldOn = typeof body.heldOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.heldOn) ? body.heldOn : cur.heldOn;
      const enteredCount = entries.filter(isEntered).length;
      const submit = body.action === "SUBMIT";
      if (submit && enteredCount < entries.length) throw new CeaError(`${entries.length - enteredCount} student(s) have no marks - enter them or mark Absent`);
      if (submit && !mid && !heldOn) throw new CeaError("Give the date the assessment was held");
      const next: CeaMarksSheet = {
        ...cur, entries, enteredCount, ...(heldOn ? { heldOn } : {}), rev: cur.rev + 1, updatedAt: at, updatedByName: session.email,
        ...(submit ? { status: "SUBMITTED" as const, submittedAt: at } : {}),
      };
      tx.set(ref, next);
      return next;
    });
    if (body.action === "SUBMIT" || body.action === "REOPEN") {
      await syncCeaIntoInternal(db, session.collegeId, saved.assignmentId);
      await writeAuditLogSafe(db, session.collegeId, {
        action: `CEA_MARKS_${body.action}`, performedBy: session.uid, performedByName: session.email, targetId: sheetId,
        details: { subjectCode: saved.subjectCode, section: saved.sectionName, unit: saved.unit },
      });
    }
    return NextResponse.json({ sheet: saved });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks/[sheetId] PATCH]");
  }
}
