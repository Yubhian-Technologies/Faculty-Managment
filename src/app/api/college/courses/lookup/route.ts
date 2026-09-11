export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Minimal, broadly-readable course lookup - purely for populating a picker
// (e.g. the FDP/Workshop "beneficiary students" breakdown on the Mentorship
// module - see TrainingEntryFields). Deliberately separate from
// GET /api/college/courses, which is scoped much more strictly for its real
// purpose (HOD course-catalog management, department-filtered access). This
// route returns every active course in the college with its owning
// department's name, to any same-college member - same broad access as
// GET /api/college/sections/lookup, which this feeds into.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF", "DEAN"
    );
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [coursesSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("courses").where("isActive", "==", true).get(),
      collegeRef.collection("departments").get(),
    ]);
    const deptNameById = new Map(
      deptsSnap.docs.map((d) => [d.id, (d.data() as { name?: string }).name ?? ""])
    );

    const courses = coursesSnap.docs
      .map((d) => {
        const data = d.data() as { name?: string; departmentId?: string; durationYears?: number };
        return {
          id: d.id,
          name: data.name ?? "",
          departmentId: data.departmentId ?? "",
          department: deptNameById.get(data.departmentId ?? "") ?? "",
          durationYears: data.durationYears ?? 4,
        };
      })
      .filter((c) => c.name && c.department)
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));

    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses/lookup GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
