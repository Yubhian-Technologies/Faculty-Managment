export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { loadEffectiveTiming } from "@/lib/college/semester";
import { actorName, guardError, midBankRefs } from "@/lib/midBank/server";
import { loadPlan, midTimetableRefs } from "@/lib/midTimetable/server";
import type { Course, Department, MidQuestionBank, MidTimetable } from "@/types";
import type { PaperChoiceRow } from "@/lib/midPapers/clientTypes";

// Exam Cell (a college that prepares question papers): for one exam day of a Mid timetable, every subject + branch
// on it with its APPROVED question papers, and the paper chosen for the exam. The choice is stored
// (midPaperChoices/{planId}__{date}__{subjectId}__{branch}) so the marks entry knows the paper; picking again
// replaces it. Faculty never see which paper was chosen.

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
    const mine = sets.filter((b) => b.subjectId === slot.subjectId && b.branch === slot.branch);
    const approved = mine.filter((b) => b.approval === "APPROVED" && b.status === "COMPLETE");
    const c = chosen.get(`${slot.subjectId}|${slot.branch}`);
    return {
      subjectId: slot.subjectId, subjectName: slot.subjectName, subjectCode: slot.subjectCode, branch: slot.branch, branchCode: codeOf.get(slot.branch) || slot.branch,
      papers: approved.flatMap((b) => Array.from({ length: b.pattern?.setsPerFaculty ?? 0 }, (_, i) => ({ bankId: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), setNo: i + 1 }))),
      pending: mine.filter((b) => !approved.includes(b)).map((b) => ({ ownerName: b.ownerName, stage: b.approval === "SUBMITTED" ? "with the HOD" : b.approval === "RETURNED" ? "returned by the HOD" : b.status === "COMPLETE" ? "complete, not submitted" : `${b.completeCount}/${b.totalCount} questions written` })),
      choice: c ? { bankId: String(c.bankId), setNo: Number(c.setNo), chosenByName: String(c.chosenByName ?? ""), at: String(c.at ?? "") } : null,
    };
  });
  return { plan, header, rows } as const;
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
    const body = (await readJsonBody(request)) as { planId?: string; date?: string; subjectId?: string; branch?: string; bankId?: string; setNo?: number; random?: boolean };
    const db = getAdminDb();
    const date = String(body.date ?? "");
    const r = await day(db, session.collegeId, String(body.planId ?? ""), date);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    const row = r.rows.find((x) => x.subjectId === body.subjectId && x.branch === body.branch);
    if (!row) return NextResponse.json({ error: "That subject isn't on this exam day for this branch" }, { status: 400 });
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
