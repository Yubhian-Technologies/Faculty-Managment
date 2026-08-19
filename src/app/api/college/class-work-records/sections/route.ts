export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { loadDepartmentCodes, formatSectionLabel } from "@/lib/attendance/sectionLabel";
import { countSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, TeachingAssignment } from "@/types";

// The Section tiles for the Faculty Attendance Report's first step - every
// section this faculty currently has a course/section-scoped teaching
// assignment for (see TeachingAssignment; the semester-scoped shape has no
// real Section doc/sectionId and never drives a published TimetableSlot, so
// it can't be reported on here).
//
// Every displayed field (department, section name, year, student count) is
// read straight off the Section doc itself - the canonical record - rather
// than any denormalized copy (TeachingAssignment.department/sectionName can
// drift after a section is renamed; Section.studentCount turned out to never
// be kept in sync at all - see countSectionStudents). This guarantees a
// tile's count can never disagree with what actually loads once picked.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);

    const assignmentsSnap = await collegeRef.collection("teachingAssignments")
      .where("facultyId", "==", facultyMemberId)
      .get();
    const sectionIds = Array.from(new Set(
      assignmentsSnap.docs
        .map((d) => d.data() as TeachingAssignment)
        .filter((a) => !a.isPast && a.sectionId)
        .map((a) => a.sectionId as string)
    ));

    const sectionSnaps = await Promise.all(
      sectionIds.map((id) => collegeRef.collection("sections").doc(id).get())
    );
    const sectionEntries = sectionSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ ...(snap.data() as Section), id: snap.id }));

    const codeByName = await loadDepartmentCodes(collegeRef, sectionEntries.map((s) => s.department));

    const sections = await Promise.all(
      sectionEntries.map(async (s) => ({
        sectionId: s.id,
        label: formatSectionLabel(s.department, s.name, codeByName),
        studentCount: await countSectionStudents(collegeRef, {
          department: s.department,
          sectionName: s.name,
          year: s.year,
          courseId: s.courseId,
        }),
        department: s.department,
        courseName: s.courseName ?? "",
        year: s.year,
      }))
    );

    sections.sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-work-records/sections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
