export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Finance no longer creates department budgets directly (department, purpose,
// allocatedAmount) — that bypassed the department entirely. Every doc in this
// collection is now auto-created when a budget-requests doc is FINANCE_APPROVED
// (src/app/api/college/budget-requests/[id]/route.ts), which itself is only
// reachable via a Budget Cycle (src/app/api/college/budget-cycles). This route
// is read-only.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "FINANCE", "PURCHASE_DEPT", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgets")
      .orderBy("createdAt", "desc")
      .get();

    let budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (department) budgets = budgets.filter((b) => (b as { department?: string }).department === department);
    if (status) budgets = budgets.filter((b) => (b as { status?: string }).status === status);

    return NextResponse.json({ budgets });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budgets GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
