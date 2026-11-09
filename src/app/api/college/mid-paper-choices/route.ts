export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { loadEffectiveTiming } from "@/lib/college/semester";
import { loadPlan, midTimetableRefs } from "@/lib/midTimetable/server";
import { actorName, guardError, loadOutcomes, loadSubject, midBankRefs } from "@/lib/midBank/server";
import { loadPaperQuestions } from "@/lib/midPapers/server";
import { cleanPrintLayout } from "@/lib/midPapers/printLayout";
import { partMax, setNumbers } from "@/lib/midPapers/pattern";
import { isMultiBranch, paperBranchLabel, servesBranch } from "@/lib/midBank/assignments";
import type { Course, Department, MidPaperFinal, MidQuestionBank, MidTimetable } from "@/types";
import type { PaperChoiceRow } from "@/lib/midPapers/clientTypes";

// Exam Cell (a college that prepares question papers): for one exam day of a Mid timetable, every subject + branch
// on it with its APPROVED question papers, and the paper chosen for the exam. The choice is stored
// (midPaperChoices/{planId}__{date}__{subjectId}__{branch}) so the marks entry knows the paper; picking again
// replaces it. Faculty never see which paper was chosen before the exam.
//
// Printing FINALIZES it ({ action: "finalize", layout }): a frozen copy of the printed paper (pattern, that set's
// questions, units, outcomes, header, print layout) is kept on the choice as `final` - marks entry and the faculty's
// view of the paper use that copy, never the live paper. A finalized choice can't be changed; DELETE un-finalizes it
// while no marks have been entered for the subject in that branch.

const ROLES = ["EXAM_CELL", "SUPER_ADMIN"];
const choiceId = (planId: string, date: string, subjectId: string, branch: string) =>
  `${planId}__${date}__${subjectId}__${branch}`.replace(/[/\s]+/g, "-").slice(0, 400);
const choicesCol = (db: FirebaseFirestore.Firestore, c: string) => midBankRefs(db, c).college.collection("midPaperChoices");

async function day(db: FirebaseFirestore.Firestore, collegeId: string, planId: string, date: string) {
  const plan = await loadPlan(db, collegeId, planId);
  if (!plan) return { error: "Mid timetable not found", status: 404 } as const;
  const college = midBankRefs(db, collegeId).college;
  const [tts, banksSnap, depts, course, academicYear, timing, choices] = await Promise.all([
    midTimetableRefs(db, collegeId).timetables.where("planId", "==", plan.id).get(),
    midBankRefs(db, collegeId).banks.where("deadlineId", "==", plan.id).get(),
    college.collection("departments").get(),
    plan.courseIds[0] ? college.collection("courses").doc(plan.courseIds[0]).get() : null,
    resolveCollegeAcademicYear(db, collegeId),
    plan.courseIds[0] ? loadEffectiveTiming(db, collegeId, plan.courseIds[0], plan.year) : null,
    choicesCol(db, collegeId).where("planId", "==", plan.id).where("date", "==", date).get(),
  ]);
  const onDay = tts.docs.map((d) => d.data() as MidTimetable).flatMap((t) => t.slots.filter((s) => s.date === date).map((s) => ({ ...s, branch: t.branch })));
  if (onDay.length === 0) return { error: "No exam is on that date in this Mid timetable", status: 400 } as const;
  const sets = banksSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidQuestionBank, "id">) })).filter((b) => b.kind === "PAPERS");
  const codeOf = new Map(depts.docs.map((d) => [(d.data() as Department).name, (d.data() as Department).code]));
  const chosen = new Map(choices.docs.map((d) => [`${d.get("subjectId")}|${d.get("branch")}`, d.data()]));
  const semsOfYear = [...new Set((timing?.semesters ?? []).map((s) => s.semester))].sort((a, b) => a - b);
  const header = {
    courseName: plan.courseName, courseCode: (course?.data() as Course | undefined)?.code || plan.courseName, year: plan.year, semester: plan.semester,
    semesterInYear: semsOfYear.includes(plan.semester) ? semsOfYear.indexOf(plan.semester) + 1 : null, midNumber: plan.midNumber, academicYear, date,
  };
  const rows: PaperChoiceRow[] = onDay.sort((a, b) => a.branch.localeCompare(b.branch) || a.subjectName.localeCompare(b.subjectName)).map((slot) => {
    // A paper prepared for the whole subject serves every branch it lists.
    // A set the HOD withdrew (setter removed) is never offered.
    const mine = sets.filter((b) => !b.withdrawn && b.subjectId === slot.subjectId && servesBranch(b, slot.branch));
    const approved = mine.filter((b) => b.approval === "APPROVED" && b.status === "COMPLETE");
    const c = chosen.get(`${slot.subjectId}|${slot.branch}`) as (Record<string, unknown> & { final?: MidPaperFinal }) | undefined;
    return {
      subjectId: slot.subjectId, subjectName: slot.subjectName, subjectCode: slot.subjectCode, branch: slot.branch, branchCode: codeOf.get(slot.branch) || slot.branch,
      papers: approved.flatMap((b) => (b.pattern ? setNumbers(b.pattern) : []).map((setNo) => ({ bankId: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), setNo }))),
      pending: mine.filter((b) => !approved.includes(b)).map((b) => ({ ownerName: b.ownerName, stage: b.approval === "SUBMITTED" ? "with the HOD" : b.approval === "RETURNED" ? "returned by the HOD" : b.status === "COMPLETE" ? "complete, not submitted" : `${b.completeCount}/${b.totalCount} questions written` })),
      choice: c ? {
        bankId: String(c.bankId), setNo: Number(c.setNo), chosenByName: String(c.chosenByName ?? ""), at: String(c.at ?? ""),
        final: c.final ? { at: c.final.at, byName: c.final.byName, layout: c.final.layout } : null,
      } : null,
      parts: (mine[0]?.pattern?.parts ?? []).map((p) => ({ id: p.id, label: p.label, max: partMax(p) })),
      durationMinutes: mine[0]?.pattern?.durationMinutes ?? 0,
    };
  });
  return { plan, header, rows, codeOf } as const;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const url = new URL(request.url);
    const r = await day(getAdminDb(), session.collegeId, url.searchParams.get("planId") ?? "", url.searchParams.get("date") ?? "");
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ header: r.header, rows: r.rows });
  } catch (err) {
    return guardError(err, "[college/mid-paper-choices GET]");
  }
}

/** { planId, date, subjectId, branch, bankId, setNo } or { ..., random: true } - choose the paper for the exam. */
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { action?: string; layout?: unknown; planId?: string; date?: string; subjectId?: string; branch?: string; bankId?: string; setNo?: number; random?: boolean };
    const db = getAdminDb();
    const date = String(body.date ?? "");
    const r = await day(db, session.collegeId, String(body.planId ?? ""), date);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    const row = r.rows.find((x) => x.subjectId === body.subjectId && x.branch === body.branch);
    if (!row) return NextResponse.json({ error: "That subject isn't on this exam day for this branch" }, { status: 400 });
    if (body.action === "finalize") return finalize(db, session, r, row, body.layout);
    if (row.choice?.final) return NextResponse.json({ error: "This question paper is finalized (printed) - un-finalize it first to choose another" }, { status: 409 });
    if (row.papers.length === 0) return NextResponse.json({ error: "No approved question paper for this subject yet" }, { status: 409 });
    const pick = body.random
      ? row.papers[Math.floor(Math.random() * row.papers.length)]
      : row.papers.find((p) => p.bankId === body.bankId && p.setNo === Number(body.setNo));
    if (!pick) return NextResponse.json({ error: "Pick one of the approved question papers" }, { status: 400 });
    const data = {
      planId: r.plan.id, date, subjectId: row.subjectId, branch: row.branch, bankId: pick.bankId, setNo: pick.setNo,
      chosenBy: session.uid, chosenByName: await actorName(db, session.collegeId, session.uid), at: new Date().toISOString(),
    };
    await choicesCol(db, session.collegeId).doc(choiceId(r.plan.id, date, row.subjectId, row.branch)).set(data);
    return NextResponse.json({ choice: { bankId: data.bankId, setNo: data.setNo, chosenByName: data.chosenByName, at: data.at } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-paper-choices POST]");
  }
}

type DayResult = Exclude<Awaited<ReturnType<typeof day>>, { error: string }>;

/** Freezes the chosen paper as printed (first print) or updates its print layout (a reprint), and returns the copy. */
async function finalize(db: FirebaseFirestore.Firestore, session: { uid: string; collegeId: string }, r: DayResult, row: PaperChoiceRow, rawLayout: unknown) {
  if (!row.choice) return NextResponse.json({ error: "Choose the question paper first" }, { status: 409 });
  const ref = choicesCol(db, session.collegeId).doc(choiceId(r.plan.id, r.header.date, row.subjectId, row.branch));
  const byName = await actorName(db, session.collegeId, session.uid);
  const existing = (await ref.get()).data() as { final?: MidPaperFinal } | undefined;
  let final: MidPaperFinal;
  if (existing?.final) {
    // Reprint: the frozen questions never change; only how it is laid out on paper.
    const { value, errors } = cleanPrintLayout(rawLayout, existing.final.pattern.parts, existing.final.pattern.durationMinutes);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    final = { ...existing.final, layout: value };
  } else {
    const bankSnap = await midBankRefs(db, session.collegeId).banks.doc(row.choice.bankId).get();
    const bank = bankSnap.exists ? ({ id: bankSnap.id, ...(bankSnap.data() as Omit<MidQuestionBank, "id">) }) : null;
    if (!bank?.pattern || bank.approval !== "APPROVED") return NextResponse.json({ error: "The chosen question paper is no longer approved - choose again" }, { status: 409 });
    const { value, errors } = cleanPrintLayout(rawLayout, bank.pattern.parts, bank.pattern.durationMinutes);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    const [questions, outcomes, subject] = await Promise.all([
      loadPaperQuestions(db, session.collegeId, bank.id),
      loadOutcomes(db, session.collegeId, bank.outcomesId),
      loadSubject(db, session.collegeId, bank.subjectId),
    ]);
    final = {
      at: new Date().toISOString(), byUid: session.uid, byName, bankId: bank.id, setNo: row.choice.setNo, ownerName: bank.ownerName,
      pattern: { parts: bank.pattern.parts, durationMinutes: bank.pattern.durationMinutes, instruction: bank.pattern.instruction, regdBoxes: bank.pattern.regdBoxes },
      units: bank.units ?? [],
      questions: questions.filter((q) => q.set === row.choice!.setNo).map((q) => {
        const { updatedAt: _u, rev: _r, textKeys: _t, updatedBy: _b, updatedByName: _n, ...rest } = q;
        void _u; void _r; void _t; void _b; void _n;
        return rest;
      }),
      ...(bank.outcomes ? { outcomes: bank.outcomes } : {}),
      cos: (outcomes?.cos ?? []).map((c) => ({ id: c.id, statement: c.statement })), mapping: outcomes?.mapping ?? {},
      subject: { name: bank.subjectName, code: bank.subjectCode, regulation: subject?.regulation ?? "" },
      // One branch: its code + sections. A paper of several branches (a group / all branches): every branch it is for,
      // each with its own sections ("CSE (A, B) · EEE (A)").
      ...(isMultiBranch(bank.branch)
        ? (() => { const l = paperBranchLabel(bank, (n) => r.codeOf.get(n) ?? ""); return { branchCode: l.branch, sections: l.sections }; })()
        : { branchCode: row.branchCode, sections: bank.sections.filter((s) => !s.branch || s.branch === row.branch).map((s) => s.sectionName) }),
      exam: { courseName: r.header.courseCode, year: r.header.year, semester: r.header.semester, semesterInYear: r.header.semesterInYear, midNumber: r.header.midNumber, academicYear: r.header.academicYear, date: r.header.date },
      layout: value,
    };
  }
  // update() replaces `final` whole (a merge would keep an old layout's per-part entries).
  await ref.update({ final, finalizedAt: final.at });
  return NextResponse.json({ final });
}

/** Un-finalize (?planId&date&subjectId&branch): only while no marks are entered for the subject in that branch. */
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const q = new URL(request.url).searchParams;
    const [planId, date, subjectId, branch] = ["planId", "date", "subjectId", "branch"].map((k) => q.get(k) ?? "");
    const db = getAdminDb();
    const ref = choicesCol(db, session.collegeId).doc(choiceId(planId, date, subjectId, branch));
    const snap = await ref.get();
    if (!snap.exists || !(snap.data() as { final?: unknown }).final) return NextResponse.json({ error: "This question paper isn't finalized" }, { status: 404 });
    const marks = await midBankRefs(db, session.collegeId).college.collection("internalExamMarks").where("subjectId", "==", subjectId).get();
    const entered = marks.docs.filter((d) => d.get("department") === branch && Number(d.get("enteredCount") ?? 0) > 0);
    if (entered.length) return NextResponse.json({ error: `Marks are already entered for this subject (${entered.map((d) => d.get("facultyName")).filter(Boolean).join(", ")}) - it can't be un-finalized` }, { status: 409 });
    await ref.update({ final: FieldValue.delete(), finalizedAt: FieldValue.delete() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-paper-choices DELETE]");
  }
}
