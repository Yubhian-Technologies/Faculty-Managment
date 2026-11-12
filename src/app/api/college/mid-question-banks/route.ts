export const dynamic = "force-dynamic";

import { allowedFormats } from "@/lib/midBank/validateQuestion";
import { NextResponse } from "next/server";
import { ownerDepartmentNamesLive } from "@/lib/subjects/ownerDepartment";
import { loadSyllabus } from "@/lib/subjects/syllabusServer";
import { syllabusOutcomesId } from "@/lib/subjects/syllabus";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { patternForSubject } from "@/lib/midPapers/server";
import { expandPattern, paperProgress } from "@/lib/midPapers/pattern";
import { ceaPartForMid } from "@/lib/cea/server";
import { withCeaPart } from "@/lib/cea/paper";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { bankTotals, unitStatuses } from "@/lib/midBank/rules";
import { paperSetupIssues, setupIssues, withSyllabus } from "@/lib/midBank/setup";
import { bankIdFor, checkSectionPick, claimIdFor, sectionsOf, type TeachingRow } from "@/lib/midBank/sections";
import {
  actorName, guardError, loadOutcomes, loadSubject, loginUidsOf, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject, teachingFor, subjectSplitFor } from "@/lib/midBank/server";
import { assignmentIdFor, isMultiBranch, sectionsForScope, servesBranch } from "@/lib/midBank/assignments";
import { assignmentsCol, loadAssignments } from "@/lib/midBank/assignmentsServer";
import type { MidBankAssignment, MidBankDeadline, MidQuestionBank } from "@/types";

// The faculty Question Bank module.
//   GET   every open/past deadline the caller teaches a subject for, per branch +
//         subject: the sections, who holds each, the caller's own bank and any
//         colleague's bank covering the caller's sections (read-only for them).
//   POST  { deadlineId, subjectId, branch, sectionIds } starts the caller's bank:
//         sections are claimed in one transaction (a section is in one bank only),
//         colleagues whose sections are included are notified.

export async function GET() {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const db = getAdminDb();
    const refs = midBankRefs(db, session.collegeId);
    const me = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if ((await loadMidSettings(db, session.collegeId)).midAssignment === "HOD") return NextResponse.json({ items: await hodModeItems(db, session.collegeId, me) });

    // Only deadlines whose programme + year the caller teaches a section in.
    const [deadlineSnap, mySnap] = await Promise.all([
      refs.deadlines.get(),
      refs.college.collection("teachingAssignments").where("facultyId", "==", me).get(),
    ]);
    const mySectionIds = new Set(mySnap.docs.filter((d) => !d.get("isPast")).map((d) => String(d.get("sectionId") ?? "")).filter(Boolean));
    if (mySectionIds.size === 0) return NextResponse.json({ items: [] });
    const deadlines = deadlineSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankDeadline, "id">) }));

    const items = [];
    for (const d of deadlines) {
      const rows = await teachingFor(db, session.collegeId, d);
      const mine = rows.filter((r) => r.facultyId === me);
      if (mine.length === 0) continue;
      const banks = (await refs.banks.where("deadlineId", "==", d.id).get()).docs.map((b) => ({ id: b.id, ...(b.data() as Omit<MidQuestionBank, "id">) }));
      const groups = new Map<string, TeachingRow>();
      for (const r of mine) groups.set(`${r.subjectId}|${r.branch}`, r);
      const locked = isDeadlineLocked(d.deadline);
      for (const g of groups.values()) {
        const here = banks.filter((b) => b.subjectId === g.subjectId && b.branch === g.branch);
        const heldBy = new Map<string, (typeof here)[number]>();
        for (const b of here) for (const s of b.sections) heldBy.set(s.sectionId, b);
        const sections = sectionsOf(rows, g.subjectId, g.branch).map((s) => ({
          sectionId: s.sectionId, sectionName: s.sectionName, facultyNames: s.facultyNames,
          mine: s.facultyIds.includes(me), heldBy: heldBy.get(s.sectionId)?.ownerName ?? null, bankId: heldBy.get(s.sectionId)?.id ?? null,
        }));
        const own = here.find((b) => b.ownerFacultyId === me) ?? null;
        const others = here.filter((b) => b.ownerFacultyId !== me && b.viewerFacultyIds?.includes(me));
        items.push({
          key: `${d.id}|${g.subjectId}|${g.branch}`,
          deadline: { id: d.id, deadline: d.deadline, locked, courseName: d.courseName, year: d.year, semester: d.semester, midNumber: d.midNumber },
          subject: { id: g.subjectId, name: g.subjectName, code: g.subjectCode },
          branch: g.branch,
          sections,
          myBank: own && {
            id: own.id, status: own.status, approval: own.approval ?? null, reopened: !!own.reopened, completeCount: own.completeCount, totalCount: own.totalCount,
            sections: own.sections.map((s) => s.sectionName),
            updatedAt: (own.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
          },
          sharedBanks: others.map((b) => ({ id: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), completeCount: b.completeCount, totalCount: b.totalCount })),
          // Own sections not yet in any bank - something left to prepare.
          uncovered: sections.filter((s) => s.mine && !s.bankId).map((s) => s.sectionName),
        });
      }
    }
    items.sort((a, b) => Number(a.deadline.locked) - Number(b.deadline.locked) || a.deadline.deadline.localeCompare(b.deadline.deadline) || a.subject.name.localeCompare(b.subject.name));
    return NextResponse.json({ items });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const body = (await readJsonBody(request)) as { deadlineId?: string; subjectId?: string; branch?: string; sectionIds?: string[] };
    const deadlineId = String(body.deadlineId ?? ""), subjectId = String(body.subjectId ?? ""), branch = String(body.branch ?? "");
    const db = getAdminDb();
    const refs = midBankRefs(db, session.collegeId);
    const dSnap = deadlineId ? await refs.deadlines.doc(deadlineId).get() : null;
    if (!dSnap?.exists) return NextResponse.json({ error: "This question bank isn't open (no deadline)" }, { status: 404 });
    const d = { id: dSnap.id, ...(dSnap.data() as Omit<MidBankDeadline, "id">) };
    if (isDeadlineLocked(d.deadline)) return NextResponse.json({ error: "The deadline has passed - ask the Exam Cell to extend it" }, { status: 403 });

    const [me, rows, subject] = await Promise.all([
      resolveFacultyMemberId(db, session.collegeId, session.uid),
      teachingFor(db, session.collegeId, d),
      loadSubject(db, session.collegeId, subjectId),
    ]);
    if (!subject) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    // Units / COs / mapping come from the subject's frozen syllabus (HOD prepares, Academics freezes).
    const outcomesId = syllabusOutcomesId(subjectId);
    const [rules, outcomes, exception, settings, syllabus, subjectDepartments] = await Promise.all([
      rulesForSubject(db, session.collegeId, subject), loadOutcomes(db, session.collegeId, outcomesId), subjectSplitFor(db, session.collegeId, subjectId), loadMidSettings(db, session.collegeId),
      loadSyllabus(db, session.collegeId, subjectId), ownerDepartmentNamesLive(db, session.collegeId, subject),
    ]);
    // "The HOD assigns": only an assigned setter starts it, for every section of the scope (a branch or all branches).
    const hodMode = settings.midAssignment === "HOD";
    const assignmentId = assignmentIdFor(d.id, subjectId, branch);
    const assignment = hodMode ? ((await assignmentsCol(db, session.collegeId).doc(assignmentId).get()).data() as MidBankAssignment | undefined) : undefined;
    const available = hodMode ? sectionsForScope(rows, subjectId, branch) : sectionsOf(rows, subjectId, branch);
    if (hodMode) {
      if (!assignment?.facultyIds.includes(me)) return NextResponse.json({ error: "Your HOD hasn't assigned you to prepare this subject" }, { status: 403 });
      if (available.length === 0) return NextResponse.json({ error: "No section has this subject yet" }, { status: 400 });
    } else if (!available.some((s) => s.facultyIds.includes(me))) return NextResponse.json({ error: "You don't teach this subject in this branch" }, { status: 403 });
    const sw = settings.outcomes;
    // A college that prepares question papers starts a paper set (same doc, kind PAPERS) to its paper pattern.
    const papers = settings.midPreparation === "PAPERS";
    const pattern = papers ? await patternForSubject(db, session.collegeId, subject) : null;
    const paperSetup = papers ? paperSetupIssues(subject, pattern, outcomes, sw, { midNumber: d.midNumber, rules, exception, midCount: settings.midCount }) : null;
    const setup = paperSetup ?? setupIssues(subject, d.midNumber, rules, outcomes, exception, sw);
    const { units } = setup;
    const issues = withSyllabus(setup.issues, { status: syllabus?.status ?? null, subjectDepartments });
    // R26 Continuous Evaluation: the unit planned "with this Mid" adds its own CEA paper to the set.
    const cea = papers ? await ceaPartForMid(db, session.collegeId, subject, d.midNumber) : { part: null };
    if (cea.issue) issues.push({ code: "NO_CEA_PLAN", who: "SYLLABUS", message: cea.issue });
    const shared = paperSetup?.shared ?? [];
    if (issues.length > 0 || (papers ? !pattern : !rules)) return NextResponse.json({ error: issues[0]?.message ?? "Setup is incomplete", issues }, { status: 400 });

    const bankId = bankIdFor(d.id, subjectId, branch, me);
    const ownerName = await actorName(db, session.collegeId, session.uid);
    const result = await db.runTransaction(async (tx) => {
      const bankRef = refs.banks.doc(bankId);
      // Assigned setters don't claim sections - several may prepare for the same sections; the Exam Cell picks.
      const claimRefs = hodMode ? [] : available.map((s) => refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)));
      const [existing, ...claimSnaps] = await tx.getAll(bankRef, ...claimRefs);
      if (existing.exists) return { status: 409, body: { error: "You already have a question bank for this subject - open it", bankId } };
      const claims = new Map<string, string>();
      claimSnaps.forEach((c, i) => { if (c.exists && c.get("bankId") !== bankId) claims.set(available[i].sectionId, String(c.get("ownerName") ?? "another faculty member")); });
      const pick = hodMode ? { sections: available, error: "" } : checkSectionPick(available, body.sectionIds ?? [], me, claims);
      if (pick.error) return { status: 409, body: { error: pick.error } };

      const now = new Date();
      const unitStatus = unitStatuses(units, [], sw, settings.bloomLevels);
      // Papers shared among the setters by the HOD: this setter writes only theirs (e.g. Paper 2).
      const myShare = assignment?.setShare?.[me];
      const myPattern = papers ? { ...withCeaPart(expandPattern(pattern!, units, shared), cea.part), ...(myShare?.length ? { sets: myShare } : {}) } : null;
      const totals = papers ? paperProgress(myPattern!, []) : bankTotals(units, unitStatus);
      const data: Omit<MidQuestionBank, "id"> = {
        deadlineId: d.id, courseName: d.courseName, year: d.year, semester: d.semester, midNumber: d.midNumber,
        subjectId, subjectName: subject.name, subjectCode: subject.code, branch, outcomesId,
        ...(hodMode ? { assignmentId, ...(isMultiBranch(branch) ? { branches: assignment!.branches } : {}) } : {}),
        sections: pick.sections, ownerFacultyId: me, ownerName, ownerUid: session.uid,
        viewerFacultyIds: [...new Set(pick.sections.flatMap((s) => s.facultyIds))],
        units, formats: papers ? [] : allowedFormats(rules!), marks: papers ? 0 : rules!.marks, unitStatus, status: "IN_PROGRESS", outcomes: sw,
        // The college's Bloom's levels now - kept for this bank / paper set (a later change never breaks it).
        bloomLevels: settings.bloomLevels,
        // A per-unit part gets a question for each of the Mid's units (fixed in this paper's copy of the pattern).
        ...(papers ? { kind: "PAPERS" as const, pattern: myPattern!, setProgress: paperProgress(myPattern!, []).setProgress } : {}),
        completeCount: totals.completeCount, totalCount: totals.totalCount,
        createdAt: now as unknown as MidQuestionBank["createdAt"], updatedAt: now as unknown as MidQuestionBank["updatedAt"],
      };
      tx.set(bankRef, data);
      if (!hodMode) for (const s of pick.sections) tx.set(refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)), { bankId, ownerFacultyId: me, ownerName, sectionId: s.sectionId, at: now });
      return { status: 201, body: { bank: { id: bankId, ...data } } };
    });

    if (result.status === 201) {
      // Colleagues whose sections this bank covers: they see it read-only.
      const bank = (result.body as { bank: MidQuestionBank }).bank;
      const others = bank.viewerFacultyIds.filter((f) => f !== me);
      const uids = await loginUidsOf(db, session.collegeId, others);
      for (const f of others) {
        const uid = uids.get(f);
        const secs = bank.sections.filter((s) => s.facultyIds.includes(f)).map((s) => s.sectionName).join(", ");
        const what = papers ? "question papers" : "question bank";
        if (uid) await notify(db, session.collegeId, uid, "MID_BANK_SHARED", `${ownerName} is preparing your Mid ${d.midNumber} ${what}`,
          `${subject.name} (${branch}, section ${secs}) is covered by ${ownerName}'s ${what}. You can view it${hodMode ? " and give suggestions" : ""} under Mid Question Bank.`, "/panel/mid-bank");
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks POST]");
  }
}

/**
 * "The HOD assigns": a card for each subject the caller is ASSIGNED to prepare (a branch, or all branches) - with
 * their own bank / papers - and, for each subject + branch they teach but aren't assigned, a read-only card showing
 * who prepares it (view + suggestions) or that the HOD hasn't assigned it yet.
 */
async function hodModeItems(db: FirebaseFirestore.Firestore, collegeId: string, me: string) {
  const refs = midBankRefs(db, collegeId);
  const deadlines = (await refs.deadlines.get()).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankDeadline, "id">) }));
  const items = [];
  for (const d of deadlines) {
    const assignments = await loadAssignments(db, collegeId, d.id);
    const mineAssigned = assignments.filter((a) => a.facultyIds.includes(me));
    const rows = await teachingFor(db, collegeId, d);
    const teach = rows.filter((r) => r.facultyId === me);
    if (mineAssigned.length === 0 && teach.length === 0) continue;
    const banks = (await refs.banks.where("deadlineId", "==", d.id).get()).docs.map((b) => ({ id: b.id, ...(b.data() as Omit<MidQuestionBank, "id">) }));
    const locked = isDeadlineLocked(d.deadline);
    const deadline = { id: d.id, deadline: d.deadline, locked, courseName: d.courseName, year: d.year, semester: d.semester, midNumber: d.midNumber };
    const summary = (b: (typeof banks)[number]) => ({ id: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => (s.branch && isMultiBranch(b.branch) ? `${s.branch} ${s.sectionName}` : s.sectionName)), completeCount: b.completeCount, totalCount: b.totalCount });
    const sectionView = (subjectId: string, branch: string) => sectionsForScope(rows, subjectId, branch).map((s) => ({
      sectionId: s.sectionId, sectionName: isMultiBranch(branch) && s.branch ? `${s.branch} ${s.sectionName}` : s.sectionName, facultyNames: s.facultyNames,
      mine: s.facultyIds.includes(me), heldBy: null, bankId: null,
    }));
    // 1. What I'm assigned to prepare.
    for (const a of mineAssigned) {
      const own = banks.find((b) => b.id === bankIdFor(d.id, a.subjectId, a.branch, me));
      const others = a.facultyNames.filter((_, i) => a.facultyIds[i] !== me).filter(Boolean);
      items.push({
        key: `${d.id}|${a.subjectId}|${a.branch}`, deadline, subject: { id: a.subjectId, name: a.subjectName, code: a.subjectCode }, branch: a.branch,
        sections: sectionView(a.subjectId, a.branch),
        myBank: own ? {
          id: own.id, status: own.status, approval: own.approval ?? null, reopened: !!own.reopened, completeCount: own.completeCount, totalCount: own.totalCount,
          sections: own.sections.map((s) => s.sectionName), updatedAt: (own.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
        } : null,
        sharedBanks: [],
        // Something left to prepare: shows the Prepare button until started.
        uncovered: own ? [] : ["all"],
        note: `Assigned by ${a.assignedByName || "your HOD"}${a.setShare?.[me]?.length ? ` - you write Paper ${a.setShare[me].join(", ")}` : ""}${a.scope === "SUBJECT" || a.scope === "GROUP" ? ` - one paper for ${a.branches.join(", ")}` : ""}${others.length ? ` · also preparing: ${others.join(", ")}` : ""}`,
      });
    }
    // 2. What I teach but don't prepare: read-only view of the papers that serve my branch, with suggestions.
    const groups = new Map<string, (typeof teach)[number]>();
    for (const r of teach) groups.set(`${r.subjectId}|${r.branch}`, r);
    for (const g of groups.values()) {
      if (mineAssigned.some((a) => a.subjectId === g.subjectId && servesBranch(a, g.branch))) continue;
      const covering = assignments.filter((a) => a.subjectId === g.subjectId && servesBranch(a, g.branch));
      const serving = banks.filter((b) => b.subjectId === g.subjectId && servesBranch(b, g.branch) && b.ownerFacultyId !== me);
      items.push({
        key: `${d.id}|${g.subjectId}|${g.branch}`, deadline, subject: { id: g.subjectId, name: g.subjectName, code: g.subjectCode }, branch: g.branch,
        sections: sectionView(g.subjectId, g.branch), myBank: null, sharedBanks: serving.map(summary), uncovered: [],
        note: covering.length
          ? `Prepared by ${[...new Set(covering.flatMap((a) => a.facultyNames))].filter(Boolean).join(", ")} (assigned by the HOD) - you can view it and give suggestions`
          : "Your HOD hasn't assigned who prepares this yet",
      });
    }
  }
  items.sort((a, b) => Number(a.deadline.locked) - Number(b.deadline.locked) || a.deadline.deadline.localeCompare(b.deadline.deadline) || a.subject.name.localeCompare(b.subject.name));
  return items;
}
