export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getDepartmentTreeNames } from "@/lib/departments/scope";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import { matchesCurrentSemester } from "@/lib/college/semester";
import type { Section, StudentAttendanceSession, TeachingAssignment } from "@/types";

// Cross-section attendance-percentage report: Department + Course + Year,
// optionally narrowed to one Section and/or one Semester (see the optional
// `semester` param below - distinct from `year`, the course's ordinal
// academic year, e.g. "2nd Year"), with a percentage range filter - for
// finding students below (or above) a threshold, e.g. exam-eligibility
// defaulters. Reuses the exact same roster (lib/students/sectionRoster.ts)
// and per-student Held/Attended/% math as section-attendance-report's own
// "till now" mode, just looped across every section in scope instead of one -
// there's no cross-section report like this today.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

// Same leniency `matchesCurrentSemester` documents everywhere else - a
// subject never tagged with a semester (course-year has none configured)
// still counts regardless of which semester was requested, rather than
// silently disappearing.
async function sectionSubjectIds(
  collegeRef: FirebaseFirestore.DocumentReference,
  sectionId: string,
  requestedSemester: number | null
): Promise<string[]> {
  const snap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const a = doc.data() as TeachingAssignment;
    if (a.isPast) continue;
    if (requestedSemester != null && !matchesCurrentSemester(a.timetableSemester, requestedSemester)) continue;
    ids.add(a.subjectId);
  }
  return Array.from(ids);
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    // Guard: requireCollegeMember only guarantees a member and a role present
    // in READ_ROLES. If the role list changes, an unknown role would otherwise
    // fall through to the section-scoped scan below - reject closed instead.
    if (!READ_ROLES.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    const courseId = searchParams.get("courseId");
    const yearParam = searchParams.get("year");
    const sectionId = searchParams.get("sectionId");
    const semesterParam = searchParams.get("semester");
    const listSections = searchParams.get("listSections") === "true";
    const minPctParam = searchParams.get("minPct");
    const maxPctParam = searchParams.get("maxPct");

    if (!department || !courseId || !yearParam) {
      return NextResponse.json({ error: "Department, Course and Year are required" }, { status: 400 });
    }
    const year = Number(yearParam);
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Year must be a valid number" }, { status: 400 });
    }
    // Optional - omitted keeps today's behavior (every semester mixed
    // together). Same fail-closed convention as minPct/maxPct below rather
    // than silently no-op-ing on a garbage value.
    const requestedSemester = semesterParam != null && semesterParam !== "" ? Number(semesterParam) : null;
    if (requestedSemester != null && !Number.isFinite(requestedSemester)) {
      return NextResponse.json({ error: "semester must be a valid number" }, { status: 400 });
    }
    // Never let a garbage minPct/maxPct silently no-op the filter (NaN
    // comparisons are always false) - fail closed on a bad param instead.
    if (minPctParam != null && !Number.isFinite(Number(minPctParam))) {
      return NextResponse.json({ error: "minPct must be a valid number" }, { status: 400 });
    }
    if (maxPctParam != null && !Number.isFinite(Number(maxPctParam))) {
      return NextResponse.json({ error: "maxPct must be a valid number" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let sections: Section[];
    if (sectionId) {
      const snap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!snap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      sections = [{ ...(snap.data() as Section), id: snap.id }];
    } else {
      // Include sub-departments (e.g. "Basic Science" covering its child
      // branches) so a parent-department pick doesn't silently drop their
      // sections from the defaulter report - same expansion already used by
      // GET /api/college/faculty and /api/college/subjects.
      const treeNames = await getDepartmentTreeNames(db, session.collegeId, department);
      const snap = await collegeRef.collection("sections")
        .where("department", "in", treeNames.slice(0, 30))
        .where("courseId", "==", courseId)
        .where("year", "==", year)
        .get();
      sections = snap.docs.map((d) => ({ ...(d.data() as Section), id: d.id }));
    }

    // Just a lookup for the Section picker - department/course/year are
    // already fixed by the time the frontend asks for this.
    if (listSections) {
      return NextResponse.json({
        sections: sections.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    const minPct = minPctParam ? Number(minPctParam) : null;
    const maxPct = maxPctParam ? Number(maxPctParam) : null;

    const results: {
      studentId: string; name: string; rollNumber: string; sectionName: string;
      held: number; attended: number; percentage: number | null;
    }[] = [];

    for (const section of sections) {
      const [subjectIds, sessionsSnap, roster] = await Promise.all([
        sectionSubjectIds(collegeRef, section.id, requestedSemester),
        collegeRef.collection("studentAttendance")
          .where("sectionId", "==", section.id)
          .where("status", "==", "SUBMITTED")
          .get(),
        fetchSectionStudents(collegeRef, {
          department: section.department, sectionName: section.name,
          year: section.year, courseId: section.courseId,
        }),
      ]);

      const sessionsBySubject = new Map<string, StudentAttendanceSession[]>();
      for (const d of sessionsSnap.docs) {
        const r = d.data() as StudentAttendanceSession;
        // Same leniency as sectionSubjectIds above - a session never tagged
        // with a semester still counts regardless of what was requested.
        if (requestedSemester != null && !matchesCurrentSemester(r.semester, requestedSemester)) continue;
        if (!sessionsBySubject.has(r.subjectId)) sessionsBySubject.set(r.subjectId, []);
        sessionsBySubject.get(r.subjectId)!.push(r);
      }

      for (const stu of roster) {
        let held = 0;
        let attended = 0;
        for (const subjectId of subjectIds) {
          const sessionsForSubject = sessionsBySubject.get(subjectId) ?? [];
          held += sessionsForSubject.length;
          attended += sessionsForSubject.filter(
            (r) => r.entries.find((e) => e.studentId === stu.id)?.status === "PRESENT"
          ).length;
        }
        // null (not 0) when no periods have been held yet - a student with
        // no data recorded is not the same as a confirmed 0% attendance
        // defaulter (see lib/studentAttendance/percentage.ts's own
        // doc-comment), and must never be silently caught by a "below X%"
        // filter or shown with the same shortage styling as a real 0%.
        const percentage = calcPercent(attended, held);
        results.push({
          studentId: stu.id, name: stu.name, rollNumber: stu.rollNumber,
          sectionName: section.name, held, attended, percentage,
        });
      }
    }

    // A percentage-range filter can't meaningfully match a no-data (null)
    // student - exclude them whenever either bound is actually set, rather
    // than falling through the null/undefined comparison (which JS resolves
    // via numeric coercion, e.g. `null < 10` -> true) into the wrong side.
    const filtered = results.filter((r) => {
      if ((minPct != null || maxPct != null) && r.percentage == null) return false;
      if (minPct != null && r.percentage! < minPct) return false;
      if (maxPct != null && r.percentage! > maxPct) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (a.percentage == null && b.percentage == null) return a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true });
      if (a.percentage == null) return 1;
      if (b.percentage == null) return -1;
      return a.percentage - b.percentage || a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true });
    });

    return NextResponse.json({
      students: filtered,
      totalStudents: results.length,
      matchedCount: filtered.length,
      sectionsCount: sections.length,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance-percentage-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
