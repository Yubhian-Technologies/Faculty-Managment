export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Minimal, broadly-readable section-by-course+year lookup - purely for
// populating a picker (e.g. the FDP/Workshop "beneficiary students" section
// breakdown on the Mentorship module - see TrainingEntryFields, whose own
// Course -> Year -> Section flow drives this). Deliberately separate from
// GET /api/college/sections, which is scoped much more strictly for its real
// purpose (rostering/timetable ownership - a PANEL_MEMBER/COLLEGE_STAFF there
// only ever sees sections they're incharge of). This route only ever returns
// {id, name, year} - no student counts, no faculty-incharge info - to any
// same-college member.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF", "DEAN"
    );
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const yearFilter = searchParams.get("year");
    if (!courseId || !yearFilter) {
      return NextResponse.json({ error: "courseId and year are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const sectionsSnap = await collegeRef
      .collection("sections")
      .where("courseId", "==", courseId)
      .where("year", "==", Number(yearFilter))
      .get();

    const sections = sectionsSnap.docs
      .map((d) => {
        const data = d.data() as { name?: string; year?: number };
        return { id: d.id, name: data.name ?? "", year: data.year ?? Number(yearFilter) };
      })
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sections/lookup GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
