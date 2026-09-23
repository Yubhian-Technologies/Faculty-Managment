export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Read-only student lookup within one department of a college outside the
// caller's own tenant - same shape/reasoning as the sibling faculty/ route.
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

    const snap = await db.collection("colleges").doc(collegeId).collection("students")
      .where("department", "==", department).get();
    const students = snap.docs.map((d) => {
      const data = d.data() as { name?: string; rollNumber?: string; year?: number; section?: string; status?: string; email?: string };
      return {
        id: d.id,
        name: data.name ?? "",
        rollNumber: data.rollNumber ?? "",
        year: data.year ?? null,
        section: data.section ?? "",
        status: data.status ?? "",
        email: data.email ?? "",
      };
    });
    students.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ students });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/college-browse/students GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
