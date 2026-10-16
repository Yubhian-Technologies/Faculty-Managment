export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Department } from "@/types";

// A single college's department list, for Super Admin pages that need a
// department picker for a college they don't have an ambient collegeId for
// (e.g. the Faculty Profile Completion report's college + department
// filters - see FacultyProfileCompletionView.tsx). GET /api/college/departments
// can't be reused here: it resolves the college from the caller's own
// session, which is always empty for a global SUPER_ADMIN session.
export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const collegeId = new URL(request.url).searchParams.get("collegeId");
    if (!collegeId) return NextResponse.json({ error: "collegeId is required" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(collegeId).collection("departments").get();
    const departments = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Department[];
    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
