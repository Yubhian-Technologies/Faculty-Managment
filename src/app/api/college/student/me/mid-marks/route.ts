export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { midMarksSheetsCol } from "@/lib/midMarks/server";
import { partMarks } from "@/lib/midMarks/sheet";
import { NOT_ATTEMPTED, type MidMarksSheet } from "@/types/midMarks";

// The signed-in student's own Mid marks (always resolved from the session): every FROZEN sheet of their section that
// lists them - each component's marks (Descriptive / Quiz / Activity ...) and the written questions box by box
// ("-" = not attempted) with their CO. Sheets the Exam Cell hasn't frozen yet are not shown.

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
    const sheets = (await midMarksSheetsCol(db, session.collegeId).where("courseId", "==", st.courseId).where("sectionName", "==", st.section).where("status", "==", "FROZEN").get()).docs
      .map((d) => d.data() as MidMarksSheet)
      .filter((s) => branches.has(s.department) && (s.year == null || st.year == null || s.year === st.year));

    const bySubject = new Map<string, { subjectId: string; code: string; name: string; mids: unknown[] }>();
    for (const s of sheets) {
      const e = s.entries.find((x) => x.studentId === st.id);
      if (!e) continue;
      const parts = partMarks(s.sheet, e);
      const qCols = s.sheet.columns;
      const mid = {
        midNumber: s.midNumber,
        outOf: s.sheet.paperMax,
        total: e.absent ? null : e.total,
        absent: !!e.absent,
        parts: s.sheet.parts.map((p) => ({
          id: p.id, name: p.label, max: p.max, marks: parts[p.id],
          // Box by box for written questions (and items); a one-number part needs none.
          boxes: p.perQuestion && parts[p.id] !== "AB"
            ? qCols.filter((c) => c.partId === p.id).map((c) => { const v = e.q[c.key]; return { label: c.label, max: c.max, value: v === NOT_ATTEMPTED ? "-" : v ?? "-", ...(c.co ? { co: c.co } : {}) }; })
            : [],
          items: !!p.items,
        })),
        frozenAt: s.frozenAt ?? null,
      };
      const cur = bySubject.get(s.subjectId) ?? { subjectId: s.subjectId, code: s.subjectCode ?? "", name: s.subjectName, mids: [] };
      cur.mids.push(mid);
      bySubject.set(s.subjectId, cur);
    }
    const subjects = [...bySubject.values()]
      .map((x) => ({ ...x, mids: (x.mids as { midNumber: number }[]).sort((a, b) => a.midNumber - b.midNumber) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return NextResponse.json({ subjects });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    console.error("[student/me/mid-marks GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
