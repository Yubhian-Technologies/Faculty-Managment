export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApprovalError } from "@/lib/approvals";
import { authenticate, failure } from "@/lib/studentPermissions/http";
import { FACULTY_RAISER_ROLES } from "@/lib/studentPermissions/service";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, StudentRecord } from "@/types";

// Lets any faculty pick students for a request - not just their own department's,
// since an event can draw from several. Deliberately returns only what the picker
// needs (id, roll number, name, section) - never contact or document fields.
//   ?mode=sections                  every section in the college (id, department, course, year, name)
//   ?mode=roster&sectionId=<id>     one section's students
//   ?mode=search&q=<roll prefix>    up to 20 students whose roll number starts with q
const MAX_ROSTER = 300;
const pick = (id: string, s: StudentRecord) => ({
  id, rollNumber: s.rollNumber, name: s.name, department: s.department, year: s.year, section: s.section, hasLogin: !!s.uid,
});

export async function GET(request: Request) {
  try {
    const session = await authenticate(...FACULTY_RAISER_ROLES);
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    if (mode === "sections") {
      const snap = await collegeRef.collection("sections").select("department", "courseId", "courseName", "year", "name", "batch").get();
      const sections = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Partial<Section>) }))
        .sort((a, b) => `${a.department}${a.year}${a.name}`.localeCompare(`${b.department}${b.year}${b.name}`));
      return NextResponse.json({ sections });
    }

    if (mode === "roster") {
      const sectionId = url.searchParams.get("sectionId");
      if (!sectionId) throw new ApprovalError("INVALID", "sectionId is required", 400);
      const secSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!secSnap.exists) throw new ApprovalError("NOT_FOUND", "Section not found", 404);
      const sec = secSnap.data() as Section;
      const roster = await fetchSectionStudents(collegeRef, { department: sec.department, sectionName: sec.name, year: sec.year, courseId: sec.courseId });
      const students = roster.filter((s) => s.status === "REGULAR").slice(0, MAX_ROSTER)
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true })).map((s) => pick(s.id, s));
      return NextResponse.json({ students });
    }

    if (mode === "search") {
      const q = (url.searchParams.get("q") ?? "").trim().toUpperCase();
      if (q.length < 3) return NextResponse.json({ students: [] });
      const snap = await collegeRef.collection("students").where("rollNumber", ">=", q).where("rollNumber", "<", `${q}`).limit(20).get();
      return NextResponse.json({ students: snap.docs.map((d) => ({ d, s: d.data() as StudentRecord })).filter(({ s }) => s.status === "REGULAR").map(({ d, s }) => pick(d.id, s)) });
    }

    throw new ApprovalError("INVALID", "Unknown mode", 400);
  } catch (err) {
    return failure(err, "college/student-permissions/student-lookup GET");
  }
}
