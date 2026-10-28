export const dynamic = "force-dynamic";

import { allowedFormats } from "@/lib/midBank/validateQuestion";
import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { bankTotals, unitStatuses } from "@/lib/midBank/rules";
import { setupIssues } from "@/lib/midBank/setup";
import { bankIdFor, checkSectionPick, claimIdFor, outcomesIdFor, sectionsOf, type TeachingRow } from "@/lib/midBank/sections";
import {
  actorName, guardError, loadOutcomes, loadSubject, loginUidsOf, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject, teachingFor,
} from "@/lib/midBank/server";
import type { MidBankDeadline, MidQuestionBank } from "@/types";

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
            id: own.id, status: own.status, completeCount: own.completeCount, totalCount: own.totalCount,
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
    const available = sectionsOf(rows, subjectId, branch);
    if (!available.some((s) => s.facultyIds.includes(me))) return NextResponse.json({ error: "You don't teach this subject in this branch" }, { status: 403 });

    const outcomesId = outcomesIdFor(subjectId, branch);
    const [rules, outcomes] = await Promise.all([rulesForSubject(db, session.collegeId, subject), loadOutcomes(db, session.collegeId, outcomesId)]);
    const { issues, units } = setupIssues(subject, d.midNumber, rules, outcomes);
    if (issues.length > 0 || !rules) return NextResponse.json({ error: issues[0]?.message ?? "Setup is incomplete", issues }, { status: 400 });

    const bankId = bankIdFor(d.id, subjectId, branch, me);
    const ownerName = await actorName(db, session.collegeId, session.uid);
    const result = await db.runTransaction(async (tx) => {
      const bankRef = refs.banks.doc(bankId);
      const claimRefs = available.map((s) => refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)));
      const [existing, ...claimSnaps] = await tx.getAll(bankRef, ...claimRefs);
      if (existing.exists) return { status: 409, body: { error: "You already have a question bank for this subject - open it", bankId } };
      const claims = new Map<string, string>();
      claimSnaps.forEach((c, i) => { if (c.exists && c.get("bankId") !== bankId) claims.set(available[i].sectionId, String(c.get("ownerName") ?? "another faculty member")); });
      const pick = checkSectionPick(available, body.sectionIds ?? [], me, claims);
      if (pick.error) return { status: 409, body: { error: pick.error } };

      const now = new Date();
      const unitStatus = unitStatuses(units, []);
      const totals = bankTotals(units, unitStatus);
      const data: Omit<MidQuestionBank, "id"> = {
        deadlineId: d.id, courseName: d.courseName, year: d.year, semester: d.semester, midNumber: d.midNumber,
        subjectId, subjectName: subject.name, subjectCode: subject.code, branch, outcomesId,
        sections: pick.sections, ownerFacultyId: me, ownerName, ownerUid: session.uid,
        viewerFacultyIds: [...new Set(pick.sections.flatMap((s) => s.facultyIds))],
        units, formats: allowedFormats(rules), marks: rules.marks, unitStatus, status: "IN_PROGRESS",
        completeCount: totals.completeCount, totalCount: totals.totalCount,
        createdAt: now as unknown as MidQuestionBank["createdAt"], updatedAt: now as unknown as MidQuestionBank["updatedAt"],
      };
      tx.set(bankRef, data);
      for (const s of pick.sections) tx.set(refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)), { bankId, ownerFacultyId: me, ownerName, sectionId: s.sectionId, at: now });
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
        if (uid) await notify(db, session.collegeId, uid, "MID_BANK_SHARED", `${ownerName} is preparing your Mid ${d.midNumber} question bank`,
          `${subject.name} (${branch}, section ${secs}) is covered by ${ownerName}'s question bank. You can view it under Question Bank.`, "/panel/mid-bank");
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks POST]");
  }
}
