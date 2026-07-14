export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
export async function GET(_request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
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
