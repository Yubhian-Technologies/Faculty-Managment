export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// MANAGEMENT is read-only — this route only implements GET.
// Uses Firestore count() aggregation queries so this stays cheap as data grows
// (no document reads — the whole point is avoiding the full-collection-fetch
// pattern the rest of the management pages used to rely on).
export async function GET() {
  try {
    await requireManagement();

    const db = getAdminDb();
    const [collegesCount, departmentsCount, facultyCount, staffCount] = await Promise.all([
      db.collection("colleges").count().get(),
      db.collectionGroup("departments").count().get(),
      db.collectionGroup("facultyMembers").count().get(),
      db.collectionGroup("users").count().get(),
    ]);

    return NextResponse.json({
      totalColleges: collegesCount.data().count,
      totalDepartments: departmentsCount.data().count,
      totalFaculty: facultyCount.data().count,
      totalStaffAccounts: staffCount.data().count,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/stats GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
