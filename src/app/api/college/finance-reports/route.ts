export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  const secs = (value as { _seconds?: number; seconds?: number })._seconds
    ?? (value as { seconds?: number }).seconds;
  return typeof secs === "number" ? secs * 1000 : 0;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") as "MONTHLY" | "QUARTERLY" | "ANNUAL") ?? "MONTHLY";
    const periodLabel = searchParams.get("periodLabel") ?? "";
    const from = searchParams.get("from") ? new Date(searchParams.get("from") as string).getTime() : 0;
    const to = searchParams.get("to") ? new Date(searchParams.get("to") as string).getTime() : Date.now();
    const department = searchParams.get("department");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [budgetsSnap, paymentsSnap, budgetReqSnap, expenseReqSnap, purchaseSnap] = await Promise.all([
      collegeRef.collection("financeBudgets").get(),
      collegeRef.collection("financePayments").get(),
      collegeRef.collection("financeBudgetRequests").where("status", "==", "PENDING").get(),
      collegeRef.collection("financeExpenseRequests").where("status", "==", "PENDING").get(),
      collegeRef.collection("financePurchaseClearance").where("status", "==", "PENDING").get(),
    ]);

    let budgets = budgetsSnap.docs.map((d) => d.data());
    budgets = budgets.filter((b) => {
      const t = toMillis(b.createdAt);
      return t >= from && t <= to;
    });
    if (department) budgets = budgets.filter((b) => b.department === department);

    let payments = paymentsSnap.docs.map((d) => d.data());
    payments = payments.filter((p) => {
      const t = toMillis(p.createdAt);
      return t >= from && t <= to && (p.status === "PROCESSED" || p.status === "VERIFIED");
    });

    const byDepartment: Record<string, { allocated: number; utilized: number }> = {};
    let totalAllocated = 0;
    let totalUtilized = 0;
    for (const b of budgets) {
      const dept = (b.department as string) ?? "Unassigned";
      const allocated = Number(b.allocatedAmount ?? 0);
      const utilized = Number(b.utilizedAmount ?? 0);
      totalAllocated += allocated;
      totalUtilized += utilized;
      byDepartment[dept] = byDepartment[dept] ?? { allocated: 0, utilized: 0 };
      byDepartment[dept].allocated += allocated;
      byDepartment[dept].utilized += utilized;
    }

    const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const pendingApprovals = budgetReqSnap.size + expenseReqSnap.size + purchaseSnap.size;

    return NextResponse.json({
      period,
      periodLabel,
      totalAllocated,
      totalUtilized,
      totalPayments,
      byDepartment,
      pendingApprovals,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-reports GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
