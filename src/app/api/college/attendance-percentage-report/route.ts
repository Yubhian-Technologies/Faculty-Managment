export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, StudentAttendanceSession, TeachingAssignment } from "@/types";

// New territory for EXAM_CELL (no prior access to students/studentAttendance) -
// added here only, not to the existing HOD/Principal attendance routes.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

// Same query/dedupe shape as section-attendance-report's own (unexported)
// currentSectionSubjects - kept local rather than importing a private helper
// from another route file.
async function sectionSubjectIds(
  collegeRef: FirebaseFirestore.DocumentReference,
  sectionId: string
): Promise<string[]> {
  const snap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const a = doc.data() as TeachingAssignment;
    if (a.isPast) continue;
    ids.add(a.subjectId);
  }
  return Array.from(ids);
}

// Cross-section attendance-percentage report: Department + Course + Semester
// (year), optionally narrowed to one Section, with a percentage range filter -
// for finding students below (or above) a threshold, e.g. exam-eligibility
// defaulters. Reuses the exact same roster (lib/students/sectionRoster.ts)
// and per-student Held/Attended/% math as section-attendance-report's own
// "till now" mode, just looped across every section in scope instead of one -
// there's no cross-section report like this today.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    const courseId = searchParams.get("courseId");
    const yearParam = searchParams.get("year");
    const sectionId = searchParams.get("sectionId");
    const listSections = searchParams.get("listSections") === "true";
    const minPctParam = searchParams.get("minPct");
    const maxPctParam = searchParams.get("maxPct");

    if (!department || !courseId || !yearParam) {
      return NextResponse.json({ error: "Department, Course and Semester are required" }, { status: 400 });
    }
    const year = Number(yearParam);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let sections: Section[];
    if (sectionId) {
      const snap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!snap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      sections = [{ ...(snap.data() as Section), id: snap.id }];
    } else {
      const snap = await collegeRef.collection("sections")
        .where("department", "==", department)
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
      held: number; attended: number; percentage: number;
    }[] = [];

    for (const section of sections) {
      const [subjectIds, sessionsSnap, roster] = await Promise.all([
        sectionSubjectIds(collegeRef, section.id),
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
        const percentage = held > 0 ? Math.round((attended / held) * 100) : 0;
        results.push({
          studentId: stu.id, name: stu.name, rollNumber: stu.rollNumber,
          sectionName: section.name, held, attended, percentage,
        });
      }
    }

    const filtered = results.filter((r) => {
      if (minPct != null && r.percentage < minPct) return false;
      if (maxPct != null && r.percentage > maxPct) return false;
      return true;
    });
    filtered.sort((a, b) => a.percentage - b.percentage || a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

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
