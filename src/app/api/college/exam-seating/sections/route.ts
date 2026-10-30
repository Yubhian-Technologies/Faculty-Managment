export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { sectionLabel } from "@/lib/exams/seatingSections";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import { getSectionStudentCounts } from "@/lib/students/sectionCounts";
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
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("sections").get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Section);

    // `studentCount` on the section doc is stale (nothing writes it after
    // creation - see the same comment in /api/college/sections GET); compute
    // the real enrolled count the same way that route does, or years 2+
    // (populated by promotion, not section creation) show 0.
    const deptNames = Array.from(new Set(docs.map((d) => d.department).filter(Boolean)));
    const countMap = deptNames.length > 0 ? await getSectionStudentCounts(db, session.collegeId, deptNames) : new Map<string, number>();

    const sections: SeatingSectionRef[] = docs
      .map((s) => {
        const secondaryDepts = s.secondaryDepartments as string[] | undefined;
        const secondary = secondaryDepts?.length === 1 ? secondaryDepts[0].toLowerCase() : "";
        const key = `${s.department}|${s.name}|${s.year}|${secondary}|${s.courseId ?? ""}`;
        return {
          id: s.id, label: sectionLabel(s), department: s.department, year: s.year, name: s.name,
          studentCount: countMap.get(key) ?? 0,
        };
      })
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
