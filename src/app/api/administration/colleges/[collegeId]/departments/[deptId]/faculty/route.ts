export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

// Read-only: faculty of one department of a college in the caller's location.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string; deptId: string }> }) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { collegeId, deptId } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const [collegeSnap, deptSnap] = await Promise.all([collegeRef.get(), collegeRef.collection("departments").doc(deptId).get()]);
    const college = collegeSnap.data() as { name?: string; locationId?: string } | undefined;
    if (!college || college.locationId !== session.locationId || !deptSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const deptName = (deptSnap.data() as { name?: string }).name ?? "";

    const facultySnap = await collegeRef.collection("facultyMembers").where("department", "==", deptName).get();
    const faculty = facultySnap.docs
      .map((d) => ({ id: d.id, ...migrateFacultyDoc(d.data()) }))
      .sort((a, b) => facultyDisplayName(a as { legalName?: string }).localeCompare(facultyDisplayName(b as { legalName?: string })));

    return NextResponse.json({ faculty, collegeName: college.name ?? "", departmentName: deptName });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[administration/colleges/departments/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
