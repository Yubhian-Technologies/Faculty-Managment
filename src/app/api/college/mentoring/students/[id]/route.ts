export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildOwnProfileGroups } from "@/lib/students/ownProfile";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { loadMenteeAttendance, loadMenteeInternalMarks, loadMenteeResults } from "@/lib/mentoring/progress";

// One mentee's progress, a part at a time so each tab of the page reads only what it shows:
//   ?part=profile     (default) identity + every roster detail group
//   ?part=attendance  per-subject attendance (&semester=<n>, default: current semester so far)
//   ?part=results     published semester results with SGPA / CGPA and backlogs
//   ?part=internal    submitted internal exam marks, subject by subject
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
          groups: buildOwnProfileGroups(student),
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
      default:
        return NextResponse.json({ error: "part must be profile, attendance, results or internal" }, { status: 400 });
    }
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id] GET]");
  }
}
