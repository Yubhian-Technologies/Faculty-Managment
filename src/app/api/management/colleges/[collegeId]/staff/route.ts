export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
// Returns the first matching college-scoped user for a role (PRINCIPAL / VICE_PRINCIPAL / HOD),
// optionally filtered by department — mirrors the dedup convention used in college/users GET.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role");
    const department = searchParams.get("department");

    if (!role) {
      return NextResponse.json({ error: "role is required" }, { status: 400 });
    }

    const db = getAdminDb();
    let q = db.collection("colleges").doc(collegeId).collection("users").where("role", "==", role) as FirebaseFirestore.Query;
    if (department) {
      q = q.where("department", "==", department);
    }

    const snap = await q.limit(1).get();
    const profile = snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() };

    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/staff GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
