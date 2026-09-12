export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Minimal, broadly-readable faculty-by-department lookup - purely for
// populating a picker (e.g. the FDP/Workshop "co-conducting faculty" picker
// on the Mentorship module). Deliberately separate from GET /api/college/faculty,
// which is scoped much more strictly for its real purpose (rostering/
// assignment - a PANEL_MEMBER there gets 403'd for any department but their
// own). This route only ever returns {id, name, department, designation} -
// no PII, no salary/personal fields - to any same-college member, since a
// faculty picking co-conductors may legitimately need someone from a
// different department entirely.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF", "DEAN"
    );
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get("departmentId");
    if (!departmentId) {
      return NextResponse.json({ error: "departmentId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
    if (!deptSnap.exists) {
      return NextResponse.json({ faculty: [] });
    }
    const departmentName = (deptSnap.data() as { name?: string }).name ?? "";

    const facultySnap = await collegeRef
      .collection("facultyMembers")
      .where("department", "==", departmentName)
      .get();

    const faculty = facultySnap.docs
      .map((d) => {
        const data = d.data() as { name?: string; legalName?: string; department?: string; designation?: string; status?: string };
        return {
          id: d.id,
          name: data.legalName?.trim() || data.name?.trim() || "",
          department: data.department ?? departmentName,
          designation: data.designation ?? "",
          status: data.status ?? "",
        };
      })
      .filter((f) => f.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/lookup GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
