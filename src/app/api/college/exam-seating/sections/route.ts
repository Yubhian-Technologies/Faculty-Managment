export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { sectionLabel } from "@/lib/exams/seatingSections";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import type { Section } from "@/types";
import type { SeatingSectionRef } from "@/types/examSeating";

// Every section in the college, for the Exam Cell seating builder. Read-only
// and deliberately not the HOD-scoped /api/college/sections.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL");
    const sectionId = new URL(request.url).searchParams.get("sectionId");
    if (sectionId) {
      const db = getAdminDb();
      const one = await db.collection("colleges").doc(session.collegeId).collection("sections").doc(sectionId).get();
      if (!one.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const students = await loadSectionStudents(db, session.collegeId, { id: one.id, ...one.data() } as Section);
      return NextResponse.json({ students });
    }
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("sections").get();
    const sections: SeatingSectionRef[] = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Section)
      .map((s) => ({
        id: s.id, label: sectionLabel(s), department: s.department, year: s.year, name: s.name, studentCount: s.studentCount ?? 0,
      }))
      .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));
    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-seating/sections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
