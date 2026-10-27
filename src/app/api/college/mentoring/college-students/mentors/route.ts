export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { mentoringErrorResponse } from "@/lib/mentoring/http";

// The Principal / Vice-Principal finder's mentor list for ONE department: the mentors who have
// students in it (read from that department's students only - two fields each - never the whole
// college). Without a department the finder uses the college-wide mentor list it already holds.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const department = (new URL(request.url).searchParams.get("department") ?? "").trim();
    if (!department) return NextResponse.json({ mentors: [] });

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("students")
      .where("department", "==", department)
      .select("mentorUid", "mentorName", "status")
      .get();
    const byUid = new Map<string, string>();
    for (const d of snap.docs) {
      const s = d.data() as { mentorUid?: string; mentorName?: string; status?: string };
      if (s.status === "GRADUATED" || !s.mentorUid) continue;
      if (!byUid.has(s.mentorUid)) byUid.set(s.mentorUid, s.mentorName || "Mentor");
    }
    const mentors = [...byUid].map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ mentors });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/college-students/mentors GET]");
  }
}
