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
    const snap = await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({ department: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/departments/[deptId] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
