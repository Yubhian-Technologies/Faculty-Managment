export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { ceaRefs, loadAllCeaSettings } from "@/lib/cea/server";
import { ceaMarksCol } from "@/lib/cea/marksServer";
import { whenLabel } from "@/lib/cea/rules";
import type { CeaMarksSheet, CeaPlan } from "@/types";

// The signed-in student's own CEA (Continuous Evaluation) marks, subject by subject and unit by unit - always
// resolved from the session. Only SUBMITTED units show marks; the others show as pending.

export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) return NextResponse.json({ error: "Your login is not linked to a student record yet. Contact your College Office." }, { status: 404 });
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();
    const st = own.student;
    if (!st.courseId || !st.section) return NextResponse.json({ subjects: [] });
    const branches = new Set([st.department, st.secondaryDepartment].filter(Boolean) as string[]);
    const sheets = (await ceaMarksCol(db, session.collegeId).where("courseId", "==", st.courseId).where("sectionName", "==", st.section).get()).docs
      .map((d) => d.data() as CeaMarksSheet)
      .filter((s) => branches.has(s.department) && (s.year == null || st.year == null || s.year === st.year));
    const subjectIds = [...new Set(sheets.map((s) => s.subjectId))];
    const [plans, settings] = await Promise.all([
      subjectIds.length ? db.getAll(...subjectIds.map((id) => ceaRefs(db, session.collegeId).plans.doc(id))) : Promise.resolve([]),
      loadAllCeaSettings(db, session.collegeId),
    ]);
    const planOf = new Map(plans.filter((p) => p.exists).map((p) => [p.id, p.data() as CeaPlan]));
    const subjects = subjectIds.map((id) => {
      const plan = planOf.get(id);
      const mine = sheets.filter((s) => s.subjectId === id);
      const first = mine[0];
      const unitMarks = first.unitMarks;
      const typeLabel = (t: string) => settings.find((x) => x.courseKey === plan?.courseKey && x.regulation === plan?.regulation)?.types.find((y) => y.id === t)?.label ?? t;
      const units = (plan?.units ?? mine.map((s) => ({ unit: s.unit, title: "", typeId: s.typeId, when: s.when }))).map((u) => {
        const s = mine.find((x) => x.unit === u.unit && x.status === "SUBMITTED");
        const e = s?.entries.find((x) => x.studentId === st.id);
        return { unit: u.unit, title: u.title, type: typeLabel(u.typeId), when: whenLabel(u.when), marks: s ? e?.marks ?? null : null, absent: !!e?.absent, submitted: !!s };
      }).sort((a, b) => a.unit - b.unit);
      const done = units.filter((u) => u.submitted);
      return {
        subjectId: id, code: first.subjectCode, name: first.subjectName, unitMarks, units,
        total: done.reduce((n, u) => n + (u.marks ?? 0), 0), outOf: units.length * unitMarks, submittedUnits: done.length,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));
    return NextResponse.json({ subjects });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    console.error("[student/me/cea GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
