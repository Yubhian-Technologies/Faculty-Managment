export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { readOnlyRecordPart } from "@/lib/mentoring/readOnlyRecord";

// The signed-in student's own Mentoring Record, read-only - always resolved from session.uid,
// never an id from the client. Same parts as the mentor's view (mentoring/students/[id]):
//   ?part=mentor     who the mentor is (name only)
//   ?part=record     page 1 + 7.1: the student's details
//   ?part=semesters  the semester pages the record has
//   ?part=sheet      one semester page (&semester=<n>)
//   ?part=entries    the record's tables / lists (scholarships, meetings, ...)
// What the booklet keeps for the mentor and HOD alone (referrals, health record, semester
// remarks, mentoring notes) is left out - see lib/mentoring/studentView.ts.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const { searchParams } = new URL(request.url);
    const part = searchParams.get("part") ?? "mentor";
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) {
      return NextResponse.json({ error: "Your login is not linked to a student record yet. Please contact your College Office." }, { status: 404 });
    }
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();
    const student = own.student;

    if (part === "mentor") {
      const at = student.mentorAssignedAt as { toMillis?: () => number } | undefined;
      return NextResponse.json({
        student: { name: student.name, rollNumber: student.rollNumber ?? "" },
        mentor: student.mentorUid ? { name: student.mentorName ?? "Your mentor", assignedAt: at?.toMillis?.() ?? null } : null,
      });
    }
    const answer = await readOnlyRecordPart(db, session.collegeId, student, part, searchParams);
    return answer ?? NextResponse.json({ error: "part must be mentor, record, semesters, sheet or entries" }, { status: 400 });
  } catch (err) {
    return mentoringErrorResponse(err, "[student/me/mentoring GET]");
  }
}
