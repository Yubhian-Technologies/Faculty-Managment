export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames } from "@/lib/departments/scope";
import { getInChunks } from "@/lib/firestore/inQuery";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { toMenteeSummary } from "@/lib/mentoring/summary";
import { compareStudentsForList } from "@/lib/students/listOrder";
import type { StudentRecord } from "@/types";

const MIN_QUERY = 3;
const MAX_RESULTS = 30;

// Find a student by name or Regd. No to open their mentoring details. The HOD sees every student
// they may view (their departments' students, including a year another department runs for them) -
// never another department's.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toUpperCase();
    if (q.length < MIN_QUERY) return NextResponse.json({ students: [], tooShort: true });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { scope, canManage } = await loadHodStudentScope(db, session.collegeId, session.uid);

    const docs = await getInChunks([...new Set(editableDepartmentNames(scope))], (chunk) =>
      collegeRef.collection("students").where("department", "in", chunk)
    );
    const hits = docs
      .map((d) => ({ ...(d.data() as StudentRecord), id: d.id }))
      .filter((s) => s.status !== "GRADUATED" && ((s.rollNumber ?? "").toUpperCase().includes(q) || (s.name ?? "").toUpperCase().includes(q)));
    const viewable = await Promise.all(hits.map((s) => canManage(s)));
    const students = hits.filter((_, i) => viewable[i]).sort(compareStudentsForList).slice(0, MAX_RESULTS);
    return NextResponse.json({ students: students.map(toMenteeSummary) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/search GET]");
  }
}
