export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { parseAcademicYearStart } from "@/lib/college/academicSession";

// The college's current academic year ("2026-27") and its start year - the
// same value timetables, teaching assignments and leave stamp their records
// with (resolveCollegeAcademicYear). Exposed for pages that need it to derive
// per-year batches, since the college's start day lives in its settings.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACADEMICS");
    const label = await resolveCollegeAcademicYear(getAdminDb(), session.collegeId);
    const startYear = parseAcademicYearStart(label);
    if (startYear == null) {
      console.error("[college/academic-year/current GET] unparseable label", label);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ label, startYear });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-year/current GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
