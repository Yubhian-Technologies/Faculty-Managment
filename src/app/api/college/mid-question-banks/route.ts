export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, getRelatedDepartmentNames } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { guardError, MID_BANK_READ_ROLES, midBankRefs, rulesForSubject } from "@/lib/midBank/server";
import { setupIssues } from "@/lib/midBank/setup";
import type { MidPaperAssignment, MidQuestionBank, Subject, SubjectOutcomes, TeachingAssignment } from "@/types";

// The Mid question banks to show on a dashboard, with progress:
//   ?scope=mine        (default) the caller's own assignments - the faculty dashboard
//   ?scope=department  an HOD's departments (same scope as Mid Paper Setter), or the
//                      whole college for Principal / VP
// Reads only; a bank is created by POST [id]/start.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const scope = new URL(request.url).searchParams.get("scope") === "department" ? "department" : "mine";
    const db = getAdminDb();
    const refs = midBankRefs(db, session.collegeId);

    let query: FirebaseFirestore.Query = refs.assignments;
    if (scope === "mine") {
      query = query.where("facultyId", "==", await resolveFacultyMemberId(db, session.collegeId, session.uid));
    } else if (session.role === "HOD") {
      const s = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const lists = await Promise.all(s.ownDepartmentNames.map((n) => getRelatedDepartmentNames(db, session.collegeId, n)));
      const names = [...new Set([...lists.flat(), ...s.managedDepartmentNames])];
      if (names.length === 0) return NextResponse.json({ banks: [] });
      query = query.where("department", "in", names.slice(0, 30));
    } else if (!["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const assignments = (await query.get()).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperAssignment, "id">) }));
    if (assignments.length === 0) return NextResponse.json({ banks: [] });

    const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
    const [bankSnaps, subjectSnaps, outcomeSnaps] = await Promise.all([
      db.getAll(...assignments.map((a) => refs.banks.doc(a.id))),
      db.getAll(...subjectIds.map((id) => refs.college.collection("subjects").doc(id))),
      db.getAll(...subjectIds.map((id) => refs.outcomes.doc(id))),
    ]);
    const subjects = new Map(subjectSnaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...(s.data() as Omit<Subject, "id">) }]));
    const outcomes = new Map(outcomeSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as SubjectOutcomes]));
    const banks = new Map(bankSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as MidQuestionBank]));

    // Sections each holder teaches the subject in.
    const facultyIds = [...new Set(assignments.map((a) => a.facultyId))];
    const sections = new Map<string, Set<string>>();
    for (let i = 0; i < facultyIds.length; i += 30) {
      const snap = await refs.college.collection("teachingAssignments").where("facultyId", "in", facultyIds.slice(i, i + 30)).get();
      for (const d of snap.docs) {
        const t = d.data() as TeachingAssignment;
        if (t.isPast || !subjectIds.includes(t.subjectId)) continue;
        const name = t.sectionName || t.section;
        if (!name) continue;
        const key = `${t.facultyId}|${t.subjectId}`;
        sections.set(key, (sections.get(key) ?? new Set()).add(name));
      }
    }

    const rulesCache = new Map<string, Awaited<ReturnType<typeof rulesForSubject>>>();
    const out = [];
    for (const a of assignments) {
      const subject = subjects.get(a.subjectId);
      const bank = banks.get(a.id) ?? null;
      let issues: ReturnType<typeof setupIssues>["issues"] = [];
      if (!bank && subject) {
        if (!rulesCache.has(subject.id)) rulesCache.set(subject.id, await rulesForSubject(db, session.collegeId, subject));
        issues = setupIssues(subject, a.midNumber, rulesCache.get(subject.id) ?? null, outcomes.get(a.subjectId) ?? null).issues;
      }
      const updatedAt = (bank?.updatedAt as unknown as { toDate?: () => Date } | undefined)?.toDate?.() ?? null;
      out.push({
        id: a.id,
        subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode,
        midNumber: a.midNumber, facultyName: a.facultyName, department: a.department,
        courseName: a.courseName ?? subject?.courseName ?? "", year: a.year,
        semester: subject?.semester ?? null, regulation: subject?.regulation ?? "",
        sections: [...(sections.get(`${a.facultyId}|${a.subjectId}`) ?? [])].sort(),
        unitsCount: outcomes.get(a.subjectId)?.units.length ?? 0,
        started: Boolean(bank),
        status: bank?.status ?? "NOT_STARTED",
        units: bank?.units ?? [],
        completeCount: bank?.completeCount ?? 0,
        totalCount: bank?.totalCount ?? 0,
        draftCount: bank ? Object.values(bank.unitStatus ?? {}).reduce((n, u) => n + u.draftCount, 0) : 0,
        updatedAt: updatedAt?.toISOString() ?? null,
        issues,
      });
    }
    out.sort((x, y) => x.subjectName.localeCompare(y.subjectName) || x.midNumber - y.midNumber);
    return NextResponse.json({ banks: out });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks GET]");
  }
}
