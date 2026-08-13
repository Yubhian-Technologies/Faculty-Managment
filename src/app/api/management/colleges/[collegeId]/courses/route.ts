export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only - this route only implements GET.
// Populates the Course level of Management's Location -> College -> Principal
// -> Department -> Course -> HOD -> Faculty attendance browse view - mirrors
// GET /api/college/courses (session-scoped, unreachable by Management) but
// resolved by an explicit collegeId param instead.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get("departmentId");

    const db = getAdminDb();
    let query = db.collection("colleges").doc(collegeId).collection("courses") as FirebaseFirestore.Query;
    if (departmentId) query = query.where("departmentId", "==", departmentId);

    const snap = await query.get();
    const courses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/courses GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
