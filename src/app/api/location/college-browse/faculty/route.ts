export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

// Read-only faculty lookup within one department of a college outside the
// caller's own tenant - see departments/route.ts's comment for why this is
// its own route rather than a reuse of /api/college/faculty (which is fixed
// to session.collegeId). Deliberately returns only the fields a quick
// "does this person exist here, are they active" lookup needs - full
// profile detail stays with that college's own HOD/Principal, matching
// Location Admin's existing (view-only) reach into a college.
export async function GET(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "ADMINISTRATION");
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    const department = searchParams.get("department");
    if (!collegeId || !department) {
      return NextResponse.json({ error: "collegeId and department required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const college = collegeSnap.data() as { locationId?: string };
    if (session.role === "ADMINISTRATION" && college.locationId !== session.locationId) {
      return NextResponse.json({ error: "This college isn't in your location" }, { status: 403 });
    }

    const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .where("department", "==", department).get();
    const faculty = snap.docs.map((d) => {
      const data = d.data() as { legalName?: string; name?: string; collegeEmail?: string; designation?: string; employeeId?: string; status?: string };
      return {
        id: d.id,
        name: facultyDisplayName(data) || data.name || "",
        email: data.collegeEmail ?? "",
        designation: data.designation ?? "",
        employeeId: data.employeeId ?? "",
        status: data.status ?? "ACTIVE",
      };
    });
    faculty.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ faculty });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/college-browse/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
