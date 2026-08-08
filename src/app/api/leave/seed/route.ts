export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";

export async function POST() {
  try {
    await requireSuperAdmin();

    const db = getAdminDb();
    const col = db.collection("leaveTypes");
    const batch = db.batch();
    const now = new Date();

    for (const lt of LEAVE_TYPE_SEED) {
      const ref = col.doc(lt.id);
      batch.set(ref, { ...lt, createdAt: now, updatedAt: now }, { merge: true });
    }

    await batch.commit();
    return NextResponse.json({ seeded: LEAVE_TYPE_SEED.length });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/seed POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
