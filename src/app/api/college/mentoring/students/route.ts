export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { toMenteeSummary } from "@/lib/mentoring/summary";
import { compareStudentsForList } from "@/lib/students/listOrder";
import type { Section, StudentRecord } from "@/types";

// The HOD's two views of who has (or lacks) a mentor:
//   ?sectionId=<id>   the section's current students, each with their mentor
//   ?mentorUid=<uid>  the students that faculty member mentors
// Both only ever return students the HOD manages.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId")?.trim();
    const mentorUid = searchParams.get("mentorUid")?.trim();
    if (!sectionId && !mentorUid) {
      return NextResponse.json({ error: "sectionId or mentorUid is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { canManage } = await loadHodStudentScope(db, session.collegeId, session.uid);

    let students: (StudentRecord & { id: string })[] = [];
    if (sectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as Section;
      const allowed = await canManage({ department: section.department, year: section.year, courseId: section.courseId });
      if (!allowed) return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      students = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });
    } else if (mentorUid) {
      const snap = await collegeRef.collection("students").where("mentorUid", "==", mentorUid).get();
      const all = snap.docs.map((d) => ({ ...(d.data() as StudentRecord), id: d.id }));
      const managed = await Promise.all(all.map((s) => canManage(s)));
      students = all.filter((_, i) => managed[i]);
    }

    students.sort(compareStudentsForList);
    return NextResponse.json({ students: students.map(toMenteeSummary) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students GET]");
  }
}
