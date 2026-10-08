export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { groupTopicsByDate } from "@/lib/studentAttendance/topicsCovered";
import type { StudentAttendanceSession } from "@/types";

// The faculty member's own "Topics covered": the class work they wrote when
// submitting student attendance, grouped per class day. Always their own
// sessions (resolved from the login), never another faculty's. DRAFT sessions
// are left out - their notes may be unfinished (same rule as class-work-records).
//
//   (no params)        -> { subjects }  one entry per teaching assignment they have posted
//   ?assignmentId=A    -> { subjects, rows }  that subject's rows, optionally narrowed by
//                         ?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const assignmentId = (searchParams.get("assignmentId") ?? "").trim();
    const from = (searchParams.get("from") ?? "").trim();
    const to = (searchParams.get("to") ?? "").trim();
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if ((from && !isDate(from)) || (to && !isDate(to))) {
      return NextResponse.json({ error: "from and to must be dates (YYYY-MM-DD)" }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: "From date must be before the To date" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("studentAttendance")
      .where("facultyId", "==", session.uid)
      .where("status", "==", "SUBMITTED")
      .get();
    const sessions = snap.docs.map((d) => d.data() as StudentAttendanceSession);

    const subjectsByKey = new Map<string, { assignmentId: string; subjectName: string; subjectCode: string; sectionName: string; year?: number; department: string; last: string }>();
    for (const s of sessions) {
      if (!s.assignmentId) continue;
      const prev = subjectsByKey.get(s.assignmentId);
      if (!prev || s.date > prev.last) {
        subjectsByKey.set(s.assignmentId, {
          assignmentId: s.assignmentId,
          subjectName: s.subjectName,
          subjectCode: s.subjectCode,
          sectionName: s.sectionName,
          year: s.year,
          department: s.department,
          last: s.date,
        });
      }
    }
    const subjects = Array.from(subjectsByKey.values())
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName) || a.sectionName.localeCompare(b.sectionName));
    if (!assignmentId) return NextResponse.json({ subjects });

    const rows = groupTopicsByDate(
      sessions.filter((s) => s.assignmentId === assignmentId && (!from || s.date >= from) && (!to || s.date <= to)),
    );
    return NextResponse.json({ subjects, rows });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/topics-covered GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
