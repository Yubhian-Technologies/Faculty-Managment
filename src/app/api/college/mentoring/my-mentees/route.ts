export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { toMenteeSummary } from "@/lib/mentoring/summary";
import { compareStudentsForList } from "@/lib/students/listOrder";
import type { StudentRecord } from "@/types";

// The students the signed-in faculty member mentors. Always resolved from
// session.uid - a caller can never ask for someone else's list. An HOD who is
// also given mentees by another HOD (or by themselves) reads them here too.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("students")
      .where("mentorUid", "==", session.uid)
      .get();

    const students = snap.docs
      .map((d) => ({ ...(d.data() as StudentRecord), id: d.id }))
      // An alumnus is no longer anyone's mentee.
      .filter((s) => s.status !== "GRADUATED")
      .sort(compareStudentsForList);
    return NextResponse.json({ students: students.map(toMenteeSummary) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/my-mentees GET]");
  }
}
