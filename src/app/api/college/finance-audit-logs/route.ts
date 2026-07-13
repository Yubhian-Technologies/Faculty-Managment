export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeAuditLogs")
      .orderBy("timestamp", "desc")
      .limit(200)
      .get();

    let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (action) logs = logs.filter((l) => (l as { action?: string }).action === action);

    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-audit-logs GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
