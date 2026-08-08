export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";

export async function GET() {
  try {
    await requireRole(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "SUPER_ADMIN"
    );

    const db = getAdminDb();
    const snap = await db.collection("leaveTypes").orderBy("sortOrder").get();

    if (snap.empty) {
      return NextResponse.json({ leaveTypes: LEAVE_TYPE_SEED, seeded: false });
    }

    const leaveTypes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ leaveTypes, seeded: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/types GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
