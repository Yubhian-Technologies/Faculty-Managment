export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Read-only department listing for a college OUTSIDE the caller's own
// tenant - lets Location Admin (ADMINISTRATION) drill into any college in
// its own location to see what departments exist there, as a jumping-off
// point to search that department's faculty/students (see the sibling
// faculty/ and students/ routes in this folder). Every other department
// listing in the app (/api/college/departments) is fixed to the caller's
// OWN session.collegeId and can't be pointed at an arbitrary college, which
// is exactly why this is a separate, deliberately thin route rather than a
// reuse of that one.
export async function GET(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "ADMINISTRATION");
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const college = collegeSnap.data() as { name?: string; locationId?: string };
    if (session.role === "ADMINISTRATION" && college.locationId !== session.locationId) {
      return NextResponse.json({ error: "This college isn't in your location" }, { status: 403 });
    }

    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments").orderBy("name").get();
    const departments = deptSnap.docs.map((d) => {
      const data = d.data() as { name?: string; code?: string; hodName?: string; isActive?: boolean };
      return { id: d.id, name: data.name ?? "", code: data.code ?? "", hodName: data.hodName ?? "", isActive: data.isActive !== false };
    });

    return NextResponse.json({ collegeName: college.name ?? "", departments });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/college-browse/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
