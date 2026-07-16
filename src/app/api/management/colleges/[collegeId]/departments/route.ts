export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT and PURCHASE_DEPT are both read-only here — Purchase Dept uses this
// to populate the department level of its Location → College → Department browse view.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT", "PURCHASE_DEPT");
    const { collegeId } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(collegeId).collection("departments").orderBy("name").get();
    const departments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
