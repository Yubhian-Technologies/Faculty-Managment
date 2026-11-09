export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { cachedHodScope } from "@/lib/departments/cachedHodScope";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { sectionsOf } from "@/lib/midBank/sections";
import { guardError, loadDeadline, MID_BANK_OVERSEERS, midBankRefs, teachingForCached } from "@/lib/midBank/server";
import { departmentNamesById, ownerDepartmentNames, reviewDepartmentsOf } from "@/lib/subjects/ownerDepartment";
import { reviewingDepartment, seesBranchProgress } from "@/lib/midBank/reviewer";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { isAllBranches, servesBranch } from "@/lib/midBank/assignments";
import { loadAssignments } from "@/lib/midBank/assignmentsServer";
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
    // Everything that needs only the deadline id starts at once (each read is a trip to the database).
    const deadline = loadDeadline(db, session.collegeId, id);
    // "Who teaches what" starts as soon as the deadline is read, not after the HOD's scope.
    const rowsP = deadline.then((x) => (x ? teachingForCached(db, session.collegeId, x) : []));
    rowsP.catch(() => undefined);
    const [d, bankSnap, scope, deptNames, settings, assignments] = await Promise.all([
      deadline,
      midBankRefs(db, session.collegeId).banks.where("deadlineId", "==", id).get(),
      session.role === "HOD" ? cachedHodScope(db, session.collegeId, session.uid) : null,
      departmentNamesById(db, session.collegeId),
      loadMidSettings(db, session.collegeId),
      loadAssignments(db, session.collegeId, id),
    ]);
    if (!d) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
    const rows = await rowsP;
    const allBanks = bankSnap.docs.map((b) => ({ id: b.id, ...(b.data() as Omit<MidQuestionBank, "id">) }));
    const subjectIds = [...new Set([...rows.map((r) => r.subjectId), ...allBanks.map((b) => b.subjectId)])];
    const subjectsCol = db.collection("colleges").doc(session.collegeId).collection("subjects");
    const sylCol = db.collection("colleges").doc(session.collegeId).collection("subjectSyllabus");
    const [subjectSnaps, sylSnaps] = subjectIds.length
      ? await Promise.all([db.getAll(...subjectIds.map((sid) => subjectsCol.doc(sid))), db.getAll(...subjectIds.map((sid) => sylCol.doc(sid)), { fieldMask: ["status"] })])
      : [[], []];
    // Each subject's syllabus status: banks / papers can start only once it is frozen.
    const syllabusStatus = new Map(sylSnaps.map((x) => [x.id, x.exists ? String(x.get("status")) : null]));
    const subjects = new Map(subjectSnaps.filter((x) => x.exists).map((x) => [x.id, x.data() as Subject]));
    const reviewOf = (branch: string, subjectId: string) => reviewDepartmentsOf(branch, subjects.get(subjectId), deptNames);
    const bySubjectDept = (subjectId: string) => ownerDepartmentNames(subjects.get(subjectId), deptNames).length > 0;
    const reviews = (branch: string, subjectId: string) => !scope || !!reviewingDepartment(scope, reviewOf(branch, subjectId), bySubjectDept(subjectId));
    // The branch's own HOD keeps the progress of every subject there; a 1st-year coordinator only their own subjects.
    const visible = (branch: string, subjectId: string) => !scope || seesBranchProgress(scope, branch, bySubjectDept(subjectId)) || reviews(branch, subjectId);
    // A whole-subject paper (HOD-assigned) belongs to every branch it serves.
    const banks = allBanks.filter((b) => visible(b.branch, b.subjectId) || (b.branches ?? []).some((br) => visible(br, b.subjectId)));
    const hodMode = settings.midAssignment === "HOD";

    const keys = new Map<string, { branch: string; subjectId: string; subjectName: string; subjectCode: string }>();
    for (const r of rows) if (visible(r.branch, r.subjectId)) keys.set(`${r.branch}|${r.subjectId}`, { branch: r.branch, subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode });
    for (const b of banks) {
      for (const br of isAllBranches(b.branch) ? (b.branches ?? []) : [b.branch]) {
        if (!keys.has(`${br}|${b.subjectId}`) && visible(br, b.subjectId)) keys.set(`${br}|${b.subjectId}`, { branch: br, subjectId: b.subjectId, subjectName: b.subjectName, subjectCode: b.subjectCode });
      }
    }

    const groups = [...keys.values()].map((k) => {
      const mine = banks.filter((b) => b.subjectId === k.subjectId && servesBranch(b, k.branch));
      const covering = assignments.filter((a) => a.subjectId === k.subjectId && (a.branch === k.branch || (isAllBranches(a.branch) && a.branches.includes(k.branch))));
      const heldBy = new Map<string, (typeof mine)[number]>();
      for (const b of mine) for (const s of b.sections) heldBy.set(s.sectionId, b);
      return {
        ...k,
        reviewDepartments: reviewOf(k.branch, k.subjectId),
        // "The HOD assigns": who prepares it (null = the HOD hasn't assigned yet); absent in the other flow.
        ...(hodMode ? { assigned: covering.length ? { facultyNames: [...new Set(covering.flatMap((a) => a.facultyNames))].filter(Boolean), allBranches: covering.some((a) => isAllBranches(a.branch)), byName: covering[0].assignedByName } : null } : {}),
        canOpen: reviews(k.branch, k.subjectId),
        syllabus: syllabusStatus.get(k.subjectId) ?? null,
        sections: sectionsOf(rows, k.subjectId, k.branch).map((s) => ({ ...s, bankId: heldBy.get(s.sectionId)?.id ?? null, ownerName: heldBy.get(s.sectionId)?.ownerName ?? null })),
        banks: mine.map((b) => ({
          id: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), status: b.status, approval: b.approval ?? null,
          lastApproval: b.approvalHistory?.length ? b.approvalHistory[b.approvalHistory.length - 1] : null,
          completeCount: b.completeCount, totalCount: b.totalCount,
          updatedAt: (b.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null,
        })),
      };
    }).sort((a, b) => a.branch.localeCompare(b.branch) || a.subjectName.localeCompare(b.subjectName));

    return NextResponse.json({ deadline: { ...d, locked: isDeadlineLocked(d.deadline) }, groups, mode: settings.midAssignment, preparation: settings.midPreparation });
  } catch (err) {
    return guardError(err, "[college/mid-bank-deadlines/[id]/progress GET]");
  }
}
