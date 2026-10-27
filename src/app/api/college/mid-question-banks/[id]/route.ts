export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { bankAccess, guardError, loadOutcomes, loadQuestions, MID_BANK_READ_ROLES, midBankRefs, rulesForSubject, usedOutcomeRefs } from "@/lib/midBank/server";
import { setupIssues } from "@/lib/midBank/setup";
import type { MidQuestionBank, Subject, TeachingAssignment } from "@/types";

// Everything the setup / workspace / review screens need for one assignment's
// bank. Reads only - opening a bank never creates or changes anything.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!access.canRead) return NextResponse.json({ error: "This question bank isn't yours" }, { status: 403 });
    const { assignment } = access;
    const refs = midBankRefs(db, session.collegeId);

    const [subjectSnap, outcomes, bankSnap, teachSnap] = await Promise.all([
      refs.college.collection("subjects").doc(assignment.subjectId).get(),
      loadOutcomes(db, session.collegeId, assignment.subjectId),
      refs.banks.doc(id).get(),
      refs.college.collection("teachingAssignments").where("subjectId", "==", assignment.subjectId).where("facultyId", "==", assignment.facultyId).get(),
    ]);
    if (!subjectSnap.exists) return NextResponse.json({ error: "The subject of this assignment no longer exists" }, { status: 404 });
    const subject = { id: subjectSnap.id, ...(subjectSnap.data() as Omit<Subject, "id">) };
    const rules = await rulesForSubject(db, session.collegeId, subject);
    const bank = bankSnap.exists ? ({ id: bankSnap.id, ...(bankSnap.data() as Omit<MidQuestionBank, "id">) }) : null;
    const sections = [...new Set(teachSnap.docs.map((d) => d.data() as TeachingAssignment).filter((t) => !t.isPast).map((t) => t.sectionName || t.section || "").filter(Boolean))].sort();
    const used = outcomes ? await usedOutcomeRefs(db, session.collegeId, assignment.subjectId) : { units: new Set(), cos: new Set() };

    return NextResponse.json({
      assignment,
      subject: {
        id: subject.id, name: subject.name, code: subject.code, courseName: subject.courseName ?? assignment.courseName ?? "",
        department: subject.department ?? assignment.department, year: subject.year ?? assignment.year,
        semester: subject.semester ?? null, regulation: subject.regulation ?? "", academicYear: subject.academicYear ?? "",
      },
      sections,
      outcomes,
      rules,
      setup: bank ? { issues: [], units: bank.units } : setupIssues(subject, assignment.midNumber, rules, outcomes),
      bank,
      questions: bank ? await loadQuestions(db, session.collegeId, id) : [],
      access: {
        isHolder: access.isHolder,
        isHod: access.isHod,
        // Faculty may edit the setup until a question uses it; the HOD always (within the used-refs limit).
        canEditOutcomes: access.isHod || (access.isHolder && used.units.size === 0 && used.cos.size === 0),
      },
    });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id] GET]");
  }
}
