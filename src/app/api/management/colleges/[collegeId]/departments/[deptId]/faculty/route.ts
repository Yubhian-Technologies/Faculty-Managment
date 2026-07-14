export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string; deptId: string }> }) {
  try {
    await requireManagement();
    const { collegeId, deptId } = await params;

    const db = getAdminDb();
    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).get();
    const deptName = (deptSnap.data() as { name?: string } | undefined)?.name ?? "";

    const snap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("facultyMembers")
      .where("department", "==", deptName)
      .get();

    const faculty = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ faculty });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/departments/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
