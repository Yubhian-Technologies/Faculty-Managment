export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { ACADEMICS_ROLES, syllabusCol } from "@/lib/subjects/syllabusServer";
import type { SubjectSyllabus } from "@/types";

// Academics (Dean Academics): every subject syllabus a HOD has started - waiting to be frozen, frozen, returned,
// drafts - newest first. Principal / VP read it too. Reads only; the actions are on subjects/[id]/syllabus-outcomes.
export async function GET() {
  try {
    const session = await requireCollegeMember(...ACADEMICS_ROLES, "PRINCIPAL", "VICE_PRINCIPAL");
    const snap = await syllabusCol(getAdminDb(), session.collegeId)
      .select("subjectId", "subjectName", "subjectCode", "courseName", "regulation", "status", "units", "cos", "submittedAt", "submittedByName", "frozenAt", "frozenByName", "updatedAt", "returnRemarks")
      .get();
    const items = snap.docs.map((d) => {
      const s = d.data() as SubjectSyllabus;
      return {
        subjectId: d.id, subjectName: s.subjectName, subjectCode: s.subjectCode, courseName: s.courseName ?? "", regulation: s.regulation ?? "",
        status: s.status, units: s.units?.length ?? 0, cos: s.cos?.length ?? 0,
        submittedAt: s.submittedAt ?? null, submittedByName: s.submittedByName ?? null, frozenAt: s.frozenAt ?? null, frozenByName: s.frozenByName ?? null,
        updatedAt: s.updatedAt, returnRemarks: s.returnRemarks ?? null,
      };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return NextResponse.json({ items });
  } catch (err) {
    return guardError(err, "[college/syllabus-approvals GET]");
  }
}
