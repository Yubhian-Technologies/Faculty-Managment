export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { sectionsOf } from "@/lib/midBank/sections";
import { guardError, loadDeadline, MID_BANK_OVERSEERS, midBankRefs, teachingFor } from "@/lib/midBank/server";
import type { MidQuestionBank } from "@/types";

// Progress of one deadline, for the Exam Cell (and leadership; an HOD sees only
// their own branches): every branch -> subject -> section, which bank covers it
// and how far that bank is. Reads only.

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
    const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : null;
    const visible = (branch: string) => !scope || canHodEditDepartment(scope, branch);
    const banks = bankSnap.docs.map((b) => ({ id: b.id, ...(b.data() as Omit<MidQuestionBank, "id">) })).filter((b) => visible(b.branch));

    const keys = new Map<string, { branch: string; subjectId: string; subjectName: string; subjectCode: string }>();
    for (const r of rows) if (visible(r.branch)) keys.set(`${r.branch}|${r.subjectId}`, { branch: r.branch, subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode });
    for (const b of banks) keys.set(`${b.branch}|${b.subjectId}`, { branch: b.branch, subjectId: b.subjectId, subjectName: b.subjectName, subjectCode: b.subjectCode });

    const groups = [...keys.values()].map((k) => {
      const mine = banks.filter((b) => b.branch === k.branch && b.subjectId === k.subjectId);
      const heldBy = new Map<string, (typeof mine)[number]>();
      for (const b of mine) for (const s of b.sections) heldBy.set(s.sectionId, b);
      return {
        ...k,
        sections: sectionsOf(rows, k.subjectId, k.branch).map((s) => ({ ...s, bankId: heldBy.get(s.sectionId)?.id ?? null, ownerName: heldBy.get(s.sectionId)?.ownerName ?? null })),
        banks: mine.map((b) => ({
          id: b.id, ownerName: b.ownerName, sections: b.sections.map((s) => s.sectionName), status: b.status,
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
