export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildOwnProfileGroups } from "@/lib/students/ownProfile";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { loadMenteeAttendance, loadMenteeInternalMarks, loadMenteeResults } from "@/lib/mentoring/progress";
import { buildRecordProfile } from "@/lib/mentoring/profileRecord";
import { entriesCol, loadProfileOverrides, toEntry } from "@/lib/mentoring/recordStore";
import { buildSemesterSheet, loadSemesterOptions } from "@/lib/mentoring/semesterSheet";

// One mentee's progress, a part at a time so each tab of the page reads only what it shows:
//   ?part=profile     (default) identity + every roster detail group
//   ?part=attendance  per-subject attendance (&semester=<n>, default: current semester so far)
//   ?part=results     published semester results with SGPA / CGPA and backlogs
//   ?part=internal    submitted internal exam marks, subject by subject
// and, for the Student Mentoring Record (the college's booklet):
//   ?part=record      page 1 + 7.1: the student's details, with what the mentor still can fill in
//   ?part=semesters   the semester pages the booklet has for this student
//   ?part=sheet       one semester page (&semester=<n>): subjects, attendance, marks, grades, SGPA / CGPA
//   ?part=entries     every table / list row the mentor has written (scholarships, meetings, ...)
// Read-only. Allowed for the student's mentor and the HOD who manages them.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const part = searchParams.get("part") ?? "profile";

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const student = access.student;

    switch (part) {
      case "profile":
        return NextResponse.json({
          via: access.via,
          student: {
            id: student.id,
            name: student.name,
            rollNumber: student.rollNumber,
            department: student.department,
            secondaryDepartment: student.secondaryDepartment ?? null,
            course: student.course ?? "",
            section: student.section,
            year: student.year,
            batch: student.batch ?? "",
            status: student.status ?? "REGULAR",
            profilePhotoUrl: student.profilePhotoUrl ?? null,
            mentorName: student.mentorName ?? null,
          },
          groups: buildOwnProfileGroups(student, { includeEmpty: true }),
        });
      case "attendance": {
        const sem = searchParams.get("semester");
        const semester = sem != null && /^\d+$/.test(sem) ? Number(sem) : null;
        return NextResponse.json(await loadMenteeAttendance(db, session.collegeId, student, semester));
      }
      case "results":
        return NextResponse.json(await loadMenteeResults(db, session.collegeId, student.id));
      case "internal":
        return NextResponse.json(await loadMenteeInternalMarks(db, session.collegeId, student));
      case "record": {
        const overrides = await loadProfileOverrides(db, session.collegeId, student.id);
        return NextResponse.json({ via: access.via, ...buildRecordProfile(student as unknown as Record<string, unknown>, overrides) });
      }
      case "semesters":
        return NextResponse.json({ semesters: await loadSemesterOptions(db, session.collegeId, student) });
      case "sheet": {
        const sem = searchParams.get("semester");
        if (sem == null || !/^\d{1,2}$/.test(sem)) return NextResponse.json({ error: "semester is required" }, { status: 400 });
        const sheet = await buildSemesterSheet(db, session.collegeId, student, Number(sem));
        if (!sheet) return NextResponse.json({ error: "This student has no such semester yet" }, { status: 404 });
        return NextResponse.json({ sheet });
      }
      case "entries": {
        const snap = await entriesCol(db, session.collegeId, student.id).limit(1000).get();
        return NextResponse.json({ entries: snap.docs.map(toEntry) });
      }
      default:
        return NextResponse.json({ error: "part must be profile, attendance, results, internal, record, semesters, sheet or entries" }, { status: 400 });
    }
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id] GET]");
  }
}
