export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { whereIn } from "@/lib/firestore/inQuery";
import { holdsRole } from "@/lib/roles/seatRoles";
import { planFinalListSync, rollKey, type SyncRow, type SyncSection, type SyncStudent } from "@/lib/students/finalListSync";
import type { StudentRecord } from "@/types";

// College Office > Students > Import > "Sync with Final List": compares the college's final students list for one
// year + course with the students the app holds, and returns what differs (lib/students/finalListSync.ts). It writes
// NOTHING - the page then applies the ticked changes through the routes that already own each one: Regd. No changes ->
// students/renumber (all at once), new students ->
// students/import-excel (Office), section moves -> students/bulk-move (HOD / Principal / VP), students who left ->
// students/[id]/lifecycle DISCONTINUE, corrected details -> students/[id] PATCH details. So every rule, claim and
// audit entry of those routes applies unchanged.
//   { year, courseName?, rows: [{ line, branch, roll, name, type, gender, section, hallTicket, rank }], branchMap? }

const MAX_ROWS = 3000;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { year?: unknown; courseName?: unknown; rows?: unknown; branchMap?: unknown };
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 1 || year > 6) return NextResponse.json({ error: "Select the year of study." }, { status: 400 });
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (rawRows.length === 0) return NextResponse.json({ error: "The file has no students." }, { status: 400 });
    if (rawRows.length > MAX_ROWS) return NextResponse.json({ error: `A list can have at most ${MAX_ROWS} students.` }, { status: 400 });
    const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
    const rows: SyncRow[] = rawRows.map((r, i) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        line: Number(o.line) || i + 2, branch: str(o.branch), roll: str(o.roll), name: str(o.name), type: str(o.type),
        gender: str(o.gender), section: str(o.section), hallTicket: str(o.hallTicket), rank: str(o.rank),
      };
    });
    const branchMap = body.branchMap && typeof body.branchMap === "object" ? (body.branchMap as Record<string, string>) : {};

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [deptSnap, courseSnap, sectionSnap, studentSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("sections").where("year", "==", year).get(),
      collegeRef.collection("students").where("year", "==", year).get(),
    ]);
    const departments = deptSnap.docs
      .map((d) => d.data() as { name?: string; code?: string; isActive?: boolean })
      .filter((d) => d.name && d.isActive !== false)
      .map((d) => ({ name: d.name!, code: d.code }));
    const courseName = new Map(courseSnap.docs.map((c) => [c.id, String((c.data() as { name?: string }).name ?? "")]));
    const allSections: SyncSection[] = sectionSnap.docs.map((d) => {
      const s = d.data() as { name: string; department: string; courseId?: string; isActive?: boolean };
      return { id: d.id, name: s.name, department: s.department, courseId: s.courseId, courseName: s.courseId ? courseName.get(s.courseId) : undefined };
    });
    const courseNames = Array.from(new Set(allSections.map((s) => s.courseName).filter((n): n is string => !!n))).sort();
    const wanted = typeof body.courseName === "string" && body.courseName ? body.courseName : courseNames.length === 1 ? courseNames[0] : "";
    if (!wanted) return NextResponse.json({ error: "Select the course.", courseNames }, { status: 400 });
    const sections = allSections.filter((s) => s.courseName === wanted);

    const students: SyncStudent[] = studentSnap.docs.map((d) => {
      const s = d.data() as StudentRecord;
      return {
        id: d.id, rollNumber: s.rollNumber, name: s.name, gender: s.gender, admissionType: (s as { admissionType?: string }).admissionType,
        department: s.department, section: s.section, status: s.status, courseId: s.courseId,
        hallTicketNo: (s as { hallTicketNo?: string }).hallTicketNo,
      };
    });

    // Listed Regd. Nos the year doesn't hold: do students of OTHER years hold them?
    const inYear = new Set(students.map((s) => rollKey(s.rollNumber)).filter(Boolean));
    const unknown = Array.from(new Set(rows.map((r) => rollKey(r.roll)).filter((k) => k && !inYear.has(k))));
    const otherYearRolls = new Map<string, string>();
    if (unknown.length) {
      const snap = await whereIn(collegeRef.collection("students"), "rollNumberUpper", unknown).get();
      for (const d of snap.docs) {
        const s = d.data() as StudentRecord;
        if (s.year !== year) otherYearRolls.set(rollKey(s.rollNumber), s.status === "GRADUATED" ? "graduated" : `Year ${s.year}`);
      }
    }

    const plan = planFinalListSync({ departments, sections, students, rows, branchMap, otherYearRolls });
    return NextResponse.json({
      ...plan,
      courseName: wanted,
      courseNames,
      departments: Array.from(new Set(sections.map((s) => s.department))).sort(),
      // Which changes this login may apply (each through the route that owns it).
      can: {
        add: holdsRole(session, "COLLEGE_OFFICE", "SUPER_ADMIN"),
        move: holdsRole(session, "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"),
        discontinue: true,
        edit: true,
      },
    });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/students/final-list-sync POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
