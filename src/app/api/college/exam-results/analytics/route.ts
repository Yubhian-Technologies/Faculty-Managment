export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { batchesCol, loadResultRules, recordsCol } from "@/lib/examResults/store";
import { gradeTableFor } from "@/lib/examResults/rules";
import { buildResultsAnalytics, type AnalyticsRecord } from "@/lib/examResults/analytics";
import type { ExamResultBatch, ExamResultRecord } from "@/types/examResults";

// Results Analysis - statistics of PUBLISHED semester results.
//   GET                                          -> the classes there are results for (the filters)
//   GET ?courseKey&batch&semester[&department]   -> statistics for that class (one branch, or all in scope)
// Exam Cell, Principal and Vice Principal see every branch. An HOD sees only
// the departments they head (their own, sub-departments and managed branches) -
// enforced here, whatever the page asks for.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const db = getAdminDb();
    const q = new URL(request.url).searchParams;

    let allowed: Set<string> | null = null;
    if (session.role === "HOD") {
      allowed = new Set(editableDepartmentNames(await getHodDepartmentScope(db, session.collegeId, session.uid)));
    }
    const inScope = (b: ExamResultBatch) => b.status === "PUBLISHED" && (!allowed || allowed.has(b.department));

    const courseKey = q.get("courseKey");
    const batch = q.get("batch");
    const semester = Number(q.get("semester"));
    if (!courseKey || !batch || !semester) {
      // The filters: every class (course + batch + year/semester) with published results in scope.
      const snap = await batchesCol(db, session.collegeId).where("status", "==", "PUBLISHED").get();
      const classes = new Map<string, { courseKey: string; courseName: string; batch: string; year: number; semester: number; branches: Set<string> }>();
      for (const d of snap.docs) {
        const b = d.data() as ExamResultBatch;
        if (!inScope(b) || !b.batch) continue;
        const k = `${b.courseKey}|${b.batch}|${b.semester}`;
        const c = classes.get(k) ?? { courseKey: b.courseKey, courseName: b.courseName, batch: b.batch, year: b.year, semester: b.semester, branches: new Set<string>() };
        c.branches.add(b.department);
        classes.set(k, c);
      }
      return NextResponse.json({
        classes: [...classes.values()]
          .map((c) => ({ ...c, branches: [...c.branches].sort() }))
          .sort((a, b) => a.courseName.localeCompare(b.courseName) || b.batch.localeCompare(a.batch) || a.semester - b.semester),
      });
    }

    const department = q.get("department") || "";
    if (allowed && department && !allowed.has(department)) return NextResponse.json({ error: "That department is not yours" }, { status: 403 });

    const [{ rules }, snap] = await Promise.all([
      loadResultRules(db, session.collegeId),
      batchesCol(db, session.collegeId).where("courseKey", "==", courseKey).where("semester", "==", semester).get(),
    ]);
    const sheets = snap.docs
      .map((d) => ({ ...(d.data() as ExamResultBatch), id: d.id }))
      .filter((b) => inScope(b) && b.batch === batch && (!department || b.department === department));
    const branchOf = new Map(sheets.map((b) => [b.id, b.department]));
    const ids = [...branchOf.keys()];
    const parts: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) parts.push(ids.slice(i, i + 30));
    const snaps = await Promise.all(parts.map((p) => recordsCol(db, session.collegeId).where("batchId", "in", p).get()));

    // A revaluation's records count toward the branch of the sheet they re-grade.
    const records: AnalyticsRecord[] = snaps.flatMap((s) => s.docs).map((d) => {
      const r = d.data() as ExamResultRecord & { createdAt?: { toMillis?: () => number } };
      return {
        batchId: r.batchId, studentId: r.studentId, rollNumber: r.rollNumber, name: r.name, semester: r.semester,
        academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, revaluesBatchId: r.revaluesBatchId,
        subjects: r.subjects ?? [], branch: branchOf.get(r.batchId) ?? "", at: r.createdAt?.toMillis?.() ?? 0,
      };
    }).filter((r) => r.studentId);

    const regulation = sheets[0]?.regulation ?? "";
    return NextResponse.json({
      analytics: buildResultsAnalytics(records, rules, gradeTableFor(rules, regulation), semester),
      rules: { showSgpa: rules.showSgpa },
      sheets: sheets.map((b) => ({ id: b.id, title: b.title, examType: b.examType, examHeld: b.examHeld ?? "" })),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/analytics GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
