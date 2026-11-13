export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT, PURCHASE_DEPT, and FINANCE are all read-only here - Purchase Department and
// Finance use this to populate the department level of their Location → College →
// Department browse views.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT", "PURCHASE_DEPT", "FINANCE");
    const { collegeId } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(collegeId).collection("departments").orderBy("name").get();
    const departments = snap.docs.map((d) => ({ ...d.data(), id: d.id }));

    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[management/colleges/departments GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
