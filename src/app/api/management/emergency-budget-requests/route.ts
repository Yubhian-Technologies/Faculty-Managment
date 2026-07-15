export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeBudgetRequest, type BudgetRequest } from "@/types";

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

// MANAGEMENT is read-only — this route only implements GET. Cross-college view of
// emergency budget requests awaiting Management approval.
//
// Deliberately NOT a collectionGroup("budgetRequests") query: collection-group scope
// has to be explicitly enabled per field in Firestore (console or a deployed index),
// which "status" on budgetRequests never was, so that query throws FAILED_PRECONDITION
// in production. Querying each college's budgetRequests subcollection directly is a
// plain collection-scoped equality filter, which Firestore indexes automatically with
// zero deployment needed — same idiom already proven by college/budget-requests/route.ts.
export async function GET() {
  try {
    await requireManagement();

    const db = getAdminDb();
    const collegesSnap = await db.collection("colleges").get();
    const collegeNames = new Map(collegesSnap.docs.map((d) => [d.id, (d.data() as { name?: string }).name ?? d.id]));

    const perCollege = await Promise.all(
      collegesSnap.docs.map(async (c) => {
        const snap = await db
          .collection("colleges").doc(c.id)
          .collection("budgetRequests")
          .where("status", "==", "PENDING_MANAGEMENT_APPROVAL")
          .get();
        return snap.docs.map((d) => {
          const req = normalizeBudgetRequest({ id: d.id, ...d.data() } as BudgetRequest);
          return { ...req, collegeName: collegeNames.get(c.id) ?? c.id };
        });
      })
    );

    const requests = perCollege
      .flat()
      .sort((a, b) => toMillis((b as { createdAt?: unknown }).createdAt) - toMillis((a as { createdAt?: unknown }).createdAt));

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/emergency-budget-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
