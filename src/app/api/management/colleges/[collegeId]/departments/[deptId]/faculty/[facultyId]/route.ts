export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string; facultyId: string }> }) {
  try {
    await requireManagement();
    const { collegeId, facultyId } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const snap = await collegeRef.collection("facultyMembers").doc(facultyId).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const assignmentsSnap = await collegeRef
      .collection("teachingAssignments")
      .where("facultyId", "==", facultyId)
      .get();

    return NextResponse.json({
      faculty: { id: snap.id, ...snap.data() },
      teachingAssignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/departments/faculty/[facultyId] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
