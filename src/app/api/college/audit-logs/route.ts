export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// College-scoped counterpart to /api/admin/audit-logs (Super Admin, picks a
// college via query param) - this one is fixed to the caller's own college
// (session.collegeId) instead, since a Principal/College Admin has no reason
// to see another college's trail.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("auditLogs")
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();

    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/audit-logs GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
