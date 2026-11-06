export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { sectionsOf } from "@/lib/midBank/sections";
import { guardError, loadDeadline, MID_BANK_OVERSEERS, midBankRefs, teachingFor } from "@/lib/midBank/server";
import { departmentNamesById, reviewDepartmentsOf } from "@/lib/subjects/ownerDepartment";
import type { MidQuestionBank, Subject } from "@/types";

// Progress of one deadline, for the Exam Cell (and leadership; an HOD sees only
// their own branches): every branch -> subject -> section, which bank covers it
// and how far that bank is. Reads only.
// An HOD also sees the subjects their department looks after (Subject Department) in every
// branch - those they open and review (`canOpen`). Their own branch's subjects looked after by
// another department stay listed for progress only (`canOpen: false`).

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("HOD", ...MID_BANK_OVERSEERS);
    const { id } = await params;
    const db = getAdminDb();
    const d = await loadDeadline(db, session.collegeId, id);
    if (!d) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
    const [rows, bankSnap] = await Promise.all([
      teachingFor(db, session.collegeId, d),
      midBankRefs(db, session.collegeId).banks.where("deadlineId", "==", id).get(),
    ]);
    const allBanks = bankSnap.docs.map((b) => ({ id: b.id, ...(b.data() as Omit<MidQuestionBank, "id">) }));
    const subjectIds = [...new Set([...rows.map((r) => r.subjectId), ...allBanks.map((b) => b.subjectId)])];
    const subjectsCol = db.collection("colleges").doc(session.collegeId).collection("subjects");
    const [scope, subjectSnaps, deptNames] = await Promise.all([
      session.role === "HOD" ? getHodDepartmentScope(db, session.collegeId, session.uid) : null,
      subjectIds.length ? db.getAll(...subjectIds.map((sid) => subjectsCol.doc(sid))) : [],
      departmentNamesById(db, session.collegeId),
    ]);
    const subjects = new Map(subjectSnaps.filter((x) => x.exists).map((x) => [x.id, x.data() as Subject]));
    const reviewOf = (branch: string, subjectId: string) => reviewDepartmentsOf(branch, subjects.get(subjectId), deptNames);
    const reviews = (branch: string, subjectId: string) => !scope || reviewOf(branch, subjectId).some((dep) => canHodEditDepartment(scope, dep));
    const visible = (branch: string, subjectId: string) => !scope || canHodEditDepartment(scope, branch) || reviews(branch, subjectId);
    const banks = allBanks.filter((b) => visible(b.branch, b.subjectId));

    const keys = new Map<string, { branch: string; subjectId: string; subjectName: string; subjectCode: string }>();
    for (const r of rows) if (visible(r.branch, r.subjectId)) keys.set(`${r.branch}|${r.subjectId}`, { branch: r.branch, subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode });
    for (const b of banks) keys.set(`${b.branch}|${b.subjectId}`, { branch: b.branch, subjectId: b.subjectId, subjectName: b.subjectName, subjectCode: b.subjectCode });

    const groups = [...keys.values()].map((k) => {
      const mine = banks.filter((b) => b.branch === k.branch && b.subjectId === k.subjectId);
      const heldBy = new Map<string, (typeof mine)[number]>();
      for (const b of mine) for (const s of b.sections) heldBy.set(s.sectionId, b);
      return {
        ...k,
        reviewDepartments: reviewOf(k.branch, k.subjectId),
        canOpen: reviews(k.branch, k.subjectId),
        sections: sectionsOf(rows, k.subjectId, k.branch).map((s) => ({ ...s, bankId: heldBy.get(s.sectionId)?.id ?? null, ownerName: heldBy.get(s.sectionId)?.ownerName ?? null })),
        banks: mine.map((b) => ({
          id: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), status: b.status, approval: b.approval ?? null,
          lastApproval: b.approvalHistory?.length ? b.approvalHistory[b.approvalHistory.length - 1] : null,
          completeCount: b.completeCount, totalCount: b.totalCount,
          updatedAt: (b.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
        })),
      };
    }).sort((a, b) => a.branch.localeCompare(b.branch) || a.subjectName.localeCompare(b.subjectName));

    return NextResponse.json({ deadline: { ...d, locked: isDeadlineLocked(d.deadline) }, groups });
  } catch (err) {
    return guardError(err, "[college/mid-bank-deadlines/[id]/progress GET]");
  }
}
