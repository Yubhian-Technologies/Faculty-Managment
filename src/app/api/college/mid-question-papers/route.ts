export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { loadEffectiveTiming } from "@/lib/college/semester";
import { courseKeyForSubject, guardError, loadOutcomes, loadQuestions, loadSubject, midBankRefs } from "@/lib/midBank/server";
import { allowedFormats, formatOf } from "@/lib/midBank/validateQuestion";
import { BLOOM_LEVELS } from "@/lib/midBank/constants";
import { DEFAULT_INSTRUCTION, paperSlots, pickPaper } from "@/lib/midPaper/rules";
import { loadPlan, midTimetableRefs } from "@/lib/midTimetable/server";
import type { GeneratedPaper, GeneratedPapers, PaperQuestion } from "@/lib/midPaper/clientTypes";
import type { BloomLevel, Course, Department, MidPaperTemplate, MidQuestionBank, MidTimetable, Subject } from "@/types";

// Exam Cell: generate the Mid question papers of one exam day. Every subject the
// Mid timetable puts on that date (each branch) is matched to its question bank
// (same course + year + semester + Mid, subject, branch); only a COMPLETE bank
// gives a paper. The template (Mid Configuration > Question paper) decides each
// question's unit and level from the level picked for Question 1. Nothing is
// written - the papers are reviewed, swapped and downloaded in the browser.

const minutesBetween = (a: string, b: string) => {
  const [h1, m1] = a.split(":").map(Number); const [h2, m2] = b.split(":").map(Number);
  const d = h2 * 60 + m2 - (h1 * 60 + m1);
  return Number.isFinite(d) && d > 0 ? d : null;
};

async function templateFor(db: FirebaseFirestore.Firestore, collegeId: string, subject: Subject): Promise<MidPaperTemplate | null> {
  const key = await courseKeyForSubject(db, collegeId, subject);
  if (!key) return null;
  const snap = await midBankRefs(db, collegeId).college.collection("midPaperTemplates").where("courseKey", "==", key).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperTemplate, "id">) }));
  const reg = (subject.regulation ?? "").trim().toUpperCase();
  return all.find((t) => reg && t.regulation.toUpperCase() === reg) ?? all.find((t) => t.regulation === "ALL") ?? null;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { planId?: string; date?: string; startLevel?: string };
    const start = body.startLevel as BloomLevel;
    if (!BLOOM_LEVELS.includes(start)) return NextResponse.json({ error: "Pick the level of Question 1" }, { status: 400 });
    const date = String(body.date ?? "");
    const db = getAdminDb();
    const plan = await loadPlan(db, session.collegeId, String(body.planId ?? ""));
    if (!plan) return NextResponse.json({ error: "Mid timetable not found" }, { status: 404 });

    const college = midBankRefs(db, session.collegeId).college;
    const [tts, banksSnap, depts, course, academicYear, timing] = await Promise.all([
      midTimetableRefs(db, session.collegeId).timetables.where("planId", "==", plan.id).get(),
      midBankRefs(db, session.collegeId).banks.where("deadlineId", "==", plan.id).get(),
      college.collection("departments").get(),
      plan.courseIds[0] ? college.collection("courses").doc(plan.courseIds[0]).get() : null,
      resolveCollegeAcademicYear(db, session.collegeId),
      plan.courseIds[0] ? loadEffectiveTiming(db, session.collegeId, plan.courseIds[0], plan.year) : null,
    ]);
    const timetables = tts.docs.map((d) => d.data() as MidTimetable);
    const onDay = timetables.flatMap((t) => t.slots.filter((s) => s.date === date).map((s) => ({ ...s, branch: t.branch, sessions: t.sessions })));
    if (onDay.length === 0) return NextResponse.json({ error: "No exam is on that date in this Mid timetable" }, { status: 400 });
    const banks = banksSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidQuestionBank, "id">) }));
    const codeOf = new Map(depts.docs.map((d) => [(d.data() as Department).name, (d.data() as Department).code]));
    const session1 = plan.sessions.find((s) => s.id === onDay[0].sessionId) ?? plan.sessions[0];
    const semsOfYear = [...new Set((timing?.semesters ?? []).map((s) => s.semester))].sort((a, b) => a - b);
    const header: GeneratedPapers["header"] = {
      courseName: plan.courseName, courseCode: (course?.data() as Course | undefined)?.code || plan.courseName,
      year: plan.year, semester: plan.semester, semesterInYear: semsOfYear.includes(plan.semester) ? semsOfYear.indexOf(plan.semester) + 1 : null,
      midNumber: plan.midNumber, academicYear, date,
      minutes: session1 ? minutesBetween(session1.from, session1.to) : null, sessionLabel: plan.sessions.length > 1 ? session1?.label ?? "" : "",
    };

    const papers: GeneratedPaper[] = [];
    for (const slot of onDay.sort((a, b) => a.branch.localeCompare(b.branch) || a.subjectName.localeCompare(b.subjectName))) {
      const base = {
        branch: slot.branch, branchCode: codeOf.get(slot.branch) || slot.branch, subjectName: slot.subjectName, subjectCode: slot.subjectCode,
        regulation: "", sections: [] as string[], ownerName: "", slots: [], picked: [], candidates: {}, questions: {}, unitTitles: {}, cos: [], mapping: {},
        marks: 0, maxMarks: 0, instruction: DEFAULT_INSTRUCTION, startLevel: start,
      };
      const mine = banks.filter((b) => b.subjectId === slot.subjectId && b.branch === slot.branch);
      if (mine.length === 0) { papers.push({ ...base, key: `${slot.branch}|${slot.subjectId}`, error: "No question bank has been prepared for this subject in this branch" }); continue; }
      for (const bank of mine) {
        const key = bank.id;
        const b = { ...base, sections: bank.sections.map((s) => s.sectionName), ownerName: bank.ownerName, marks: bank.marks };
        if (bank.status !== "COMPLETE") { papers.push({ ...b, key, error: `The question bank isn't complete yet (${bank.completeCount} of ${bank.totalCount} questions)` }); continue; }
        const [subject, outcomes, questions] = await Promise.all([loadSubject(db, session.collegeId, bank.subjectId), loadOutcomes(db, session.collegeId, bank.outcomesId), loadQuestions(db, session.collegeId, bank.id)]);
        const template = subject ? await templateFor(db, session.collegeId, subject) : null;
        if (!template) { papers.push({ ...b, key, regulation: subject?.regulation ?? "", error: `No question paper template for ${plan.courseName}${subject?.regulation ? ` (${subject.regulation})` : ""} - set it in Mid Configuration > Question paper` }); continue; }
        const { slots, error } = paperSlots(bank.units, template, start);
        if (error) { papers.push({ ...b, key, regulation: subject?.regulation ?? "", error }); continue; }
        const allowed = allowedFormats(bank);
        const lite = (q: (typeof questions)[number]): PaperQuestion => ({ id: q.id, unit: q.unit, slot: q.slot, format: formatOf(q, allowed), parts: q.parts });
        const r = pickPaper(questions, slots);
        const ids = new Set(Object.values(r.candidates).flat().map((q) => q.id));
        papers.push({
          ...b, key, regulation: subject?.regulation ?? "", slots,
          picked: r.picked.map((q) => q.id),
          candidates: Object.fromEntries(Object.entries(r.candidates).map(([no, list]) => [no, list.map((q) => q.id)])),
          questions: Object.fromEntries(questions.filter((q) => ids.has(q.id)).map((q) => [q.id, lite(q)])),
          unitTitles: Object.fromEntries((outcomes?.units ?? []).map((u) => [String(u.no), u.title])),
          cos: outcomes?.cos ?? [], mapping: outcomes?.mapping ?? {},
          maxMarks: template.maxMarks ?? bank.marks * 3, instruction: template.instruction || DEFAULT_INSTRUCTION,
          ...(r.shortages.length ? { error: "Not enough questions of the right unit and level", shortages: r.shortages } : {}),
        });
      }
    }
    return NextResponse.json({ header, papers } satisfies GeneratedPapers);
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-papers POST]");
  }
}
