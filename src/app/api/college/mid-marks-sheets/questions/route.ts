export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { contextFor, midMarksSheetId, midMarksSheetsCol } from "@/lib/midMarks/server";
import { coOptionsFor, formatForSubject, sheetHasMarks } from "@/lib/midMarks/formatServer";
import { writeFormatSheet } from "@/lib/midMarks/formatSheets";
import { cleanSectionQuestions, coPendingCount, plainQuestions, sameQuestionShape } from "@/lib/midMarks/format";
import { MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import type { MidMarksSheet, MidSectionQuestion } from "@/types/midMarks";
import type { TeachingAssignment } from "@/types";

// Exam Cell > Mid Marks > Set Questions (Mid exam format colleges): a section's written-paper questions - which have
// parts (Q2(A), Q2(B)) - and the CO of each box. Only the Exam Cell sets them. The questions lock once marks are
// entered; COs can change at any time (they never change marks) - a box without a CO is "CO pending".
// GET ?assignmentId=&mid=   the format, the section's questions, CO choices, other sections of the subject
// PUT { assignmentId, midNumber, questions: { [componentId]: [{ parts, cos }] }, copyTo?: [assignmentId] }

const WRITERS = ["EXAM_CELL", "SUPER_ADMIN"] as const;

async function actor(db: FirebaseFirestore.Firestore, c: string, uid: string, email: string) {
  return ((await db.collection("colleges").doc(c).collection("users").doc(uid).get()).data() as { name?: string } | undefined)?.name ?? email;
}

/** The other current sections of the subject (to copy the questions to), with whether their sheet has marks. */
async function siblingsOf(db: FirebaseFirestore.Firestore, c: string, subjectId: string, mid: number, except: string) {
  const tas = (await db.collection("colleges").doc(c).collection("teachingAssignments").where("subjectId", "==", subjectId).get()).docs
    .map((d) => ({ ...(d.data() as TeachingAssignment), id: d.id }))
    .filter((a) => !a.isPast && a.sectionId && a.id !== except);
  const sheets = tas.length ? await db.getAll(...tas.map((a) => midMarksSheetsCol(db, c).doc(midMarksSheetId(a.id, mid)))) : [];
  return tas.map((a, i) => {
    const s = sheets[i].data() as MidMarksSheet | undefined;
    return { assignmentId: a.id, sectionName: a.sectionName ?? s?.sectionName ?? "", department: a.department ?? "", facultyName: a.facultyName ?? "", hasMarks: !!s && sheetHasMarks(s), set: !!s?.format };
  }).sort((x, y) => x.department.localeCompare(y.department) || x.sectionName.localeCompare(y.sectionName));
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITERS, "PRINCIPAL", "VICE_PRINCIPAL");
    const q = new URL(request.url).searchParams;
    const assignmentId = q.get("assignmentId") ?? "", mid = Number(q.get("mid"));
    if (!assignmentId || !(mid > 0)) throw new MidMarksError("Select the section and Mid.");
    const db = getAdminDb();
    const c = session.collegeId;
    const ctx = await contextFor(db, c, assignmentId);
    const fmt = await formatForSubject(db, c, ctx.a.subjectId);
    const sheet = (await midMarksSheetsCol(db, c).doc(midMarksSheetId(assignmentId, mid)).get()).data() as MidMarksSheet | undefined;
    if (!fmt && !sheet?.format) throw new MidMarksError("This subject has no Mid exam format. Set it in Mid Configuration › Marks.", 409);
    const hasMarks = !!sheet && sheetHasMarks(sheet);
    // A sheet with marks keeps the components it was built on; otherwise the current format applies.
    const components = hasMarks && sheet?.format ? sheet.format.components : fmt!.components;
    const questions = Object.fromEntries(components.filter((x) => x.kind === "QUESTIONS").map((x) => [x.id, sheet?.format?.questions[x.id] ?? plainQuestions(x)]));
    const [coOptions, siblings] = await Promise.all([coOptionsFor(db, c, ctx.a.subjectId), siblingsOf(db, c, ctx.a.subjectId, mid, assignmentId)]);
    return NextResponse.json({
      subjectCode: ctx.a.subjectCode, subjectName: ctx.a.subjectName, sectionName: ctx.section.name, department: ctx.section.department,
      components, questions, coOptions, siblings, hasMarks, status: sheet?.status ?? null, sheetId: sheet ? midMarksSheetId(assignmentId, mid) : null,
      coPending: coPendingCount({ components, questions }),
    });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/questions GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITERS);
    const body = (await readJsonBody(request)) as { assignmentId?: unknown; midNumber?: unknown; questions?: unknown; copyTo?: unknown };
    const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
    const mid = Number(body.midNumber);
    if (!assignmentId || !Number.isInteger(mid) || mid < 1 || mid > 6) throw new MidMarksError("Select the section and Mid.");
    const db = getAdminDb();
    const c = session.collegeId;
    const byName = await actor(db, c, session.uid, session.email);
    const ctx = await contextFor(db, c, assignmentId);
    const fmt = await formatForSubject(db, c, ctx.a.subjectId);
    const cur = (await midMarksSheetsCol(db, c).doc(midMarksSheetId(assignmentId, mid)).get()).data() as MidMarksSheet | undefined;
    if (!fmt && !cur?.format) throw new MidMarksError("This subject has no Mid exam format. Set it in Mid Configuration › Marks.", 409);
    const components = cur?.format && sheetHasMarks(cur) ? cur.format.components : fmt!.components;
    const raw = (body.questions && typeof body.questions === "object" ? body.questions : {}) as Record<string, unknown>;
    const questions: Record<string, MidSectionQuestion[]> = {};
    for (const comp of components.filter((x) => x.kind === "QUESTIONS")) {
      const r = cleanSectionQuestions(comp, raw[comp.id]);
      if ("error" in r) throw new MidMarksError(r.error);
      questions[comp.id] = r.questions;
    }
    const { sheet } = await writeFormatSheet(db, c, { assignmentId, mid, byName, components, questions });

    // Copy to other sections of the subject: same questions; a section with marks takes only the COs (same questions)
    // or is skipped.
    const copied: string[] = [];
    const skipped: { section: string; reason: string }[] = [];
    const targets = (Array.isArray(body.copyTo) ? body.copyTo : []).filter((x): x is string => typeof x === "string" && x !== assignmentId).slice(0, 60);
    for (const id of targets) {
      try {
        const other = await contextFor(db, c, id);
        if (other.a.subjectId !== ctx.a.subjectId) { skipped.push({ section: other.section.name, reason: "Another subject." }); continue; }
        const o = (await midMarksSheetsCol(db, c).doc(midMarksSheetId(id, mid)).get()).data() as MidMarksSheet | undefined;
        if (o && sheetHasMarks(o) && !Object.keys(questions).every((k) => sameQuestionShape(o.format?.questions[k], questions[k]))) {
          skipped.push({ section: other.section.name, reason: "Has marks against other questions." }); continue;
        }
        await writeFormatSheet(db, c, { assignmentId: id, mid, byName, components: o?.format && sheetHasMarks(o) ? o.format.components : components, questions });
        copied.push(other.section.name);
      } catch (e) {
        skipped.push({ section: id, reason: e instanceof MidMarksError ? e.message : "Unable to copy." });
      }
    }
    await writeAuditLogSafe(db, c, {
      action: "MID_MARKS_QUESTIONS_SET", performedBy: session.uid, performedByName: byName, targetId: sheet.id,
      details: { subjectCode: sheet.subjectCode, section: sheet.sectionName, midNumber: mid, coPending: coPendingCount(sheet.format), copied, skipped: skipped.length },
    });
    return NextResponse.json({ sheet, copied, skipped });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/questions PUT]");
  }
}
