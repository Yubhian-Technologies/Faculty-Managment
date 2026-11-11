export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { ceaErrorResponse, ceaRefs, ceaSubjects } from "@/lib/cea/server";
import { ceaMarksCol } from "@/lib/cea/marksServer";
import { ceaSheetId } from "@/lib/cea/marks";
import type { CeaMarksSheet, CeaPlan, TeachingAssignment } from "@/types";

// CEA marks by section: every current teaching assignment of a subject with a CEA plan, and each unit's sheet
// status. HOD: sections of their departments (same scope as internal marks). Exam Cell / Principal / VP: all.

export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const db = getAdminDb();
    const scope = session.role === "HOD" ? new Set(editableDepartmentNames(await getHodDepartmentScope(db, session.collegeId, session.uid))) : null;
    const list = await ceaSubjects(db, session.collegeId);
    const planSnaps = list.length ? await db.getAll(...list.map((x) => ceaRefs(db, session.collegeId).plans.doc(x.subject.id))) : [];
    const plans = new Map(planSnaps.filter((p) => p.exists).map((p) => [p.id, p.data() as CeaPlan]));
    const unitMarks = new Map(list.map((x) => [x.subject.id, x.settings.unitMarks]));
    const ids = [...plans.keys()];
    const tas: (TeachingAssignment & { id: string })[] = [];
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await ceaRefs(db, session.collegeId).college.collection("teachingAssignments").where("subjectId", "in", ids.slice(i, i + 30)).get();
      for (const d of snap.docs) {
        const a = { ...(d.data() as TeachingAssignment), id: d.id };
        if (!a.isPast && (!scope || scope.has(a.department))) tas.push(a);
      }
    }
    const sheetIds = tas.flatMap((a) => plans.get(a.subjectId)!.units.map((u) => ceaSheetId(a.id, u.unit)));
    const sheets = new Map<string, CeaMarksSheet>();
    for (let i = 0; i < sheetIds.length; i += 200) {
      const snaps = await db.getAll(...sheetIds.slice(i, i + 200).map((id) => ceaMarksCol(db, session.collegeId).doc(id)));
      snaps.forEach((s) => { if (s.exists) sheets.set(s.id, s.data() as CeaMarksSheet); });
    }
    const rows = tas.map((a) => ({
      assignmentId: a.id, subjectId: a.subjectId, subjectCode: a.subjectCode, subjectName: a.subjectName, department: a.department,
      section: a.sectionName ?? a.section ?? "", facultyName: a.facultyName ?? "", unitMarks: unitMarks.get(a.subjectId) ?? 10,
      units: plans.get(a.subjectId)!.units.map((u) => {
        const s = sheets.get(ceaSheetId(a.id, u.unit));
        return { unit: u.unit, when: u.when, sheetId: ceaSheetId(a.id, u.unit), status: s?.status ?? null, enteredCount: s?.enteredCount ?? 0, totalStudents: s?.totalStudents ?? 0, heldOn: s?.heldOn ?? null };
      }),
    })).sort((x, y) => x.department.localeCompare(y.department) || x.subjectCode.localeCompare(y.subjectCode) || x.section.localeCompare(y.section));
    return NextResponse.json({ sections: rows });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/sections GET]");
  }
}
