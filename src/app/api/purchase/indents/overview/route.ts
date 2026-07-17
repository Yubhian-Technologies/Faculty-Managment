export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { FinancePurchaseClearance, IndentRequest } from "@/types";

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

// Cross-college view for PURCHASE_DEPT and FINANCE — both are GLOBAL roles that
// serve every college across every location, so their "all requests" view needs
// to fan out over every college's indentRequests + financePurchaseClearance
// subcollections instead of the single-collegeId scope every other
// /api/college/* route uses.
//
// Deliberately NOT a collectionGroup(...) query — see the identical precedent/
// rationale in src/app/api/management/emergency-budget-requests/route.ts:
// collection-group scope needs an explicitly deployed index per queried field,
// which indentRequests/financePurchaseClearance never had, so that query would
// throw FAILED_PRECONDITION in production. Querying each college's subcollection
// directly is a plain collection-scoped filter, indexed automatically.
export async function GET(request: Request) {
  try {
    await requireRole("PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const locationIdFilter = searchParams.get("locationId");
    const collegeIdFilter = searchParams.get("collegeId");
    const status = searchParams.get("status");
    const requestType = searchParams.get("requestType"); // GOODS | NON_GOODS, indents only

    const db = getAdminDb();

    const [collegesSnap, locationsSnap] = await Promise.all([
      db.collection("colleges").get(),
      db.collection("locations").get(),
    ]);

    const locationNames = new Map(locationsSnap.docs.map((d) => [d.id, (d.data() as { name?: string }).name ?? d.id]));

    let colleges = collegesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name?: string; locationId?: string }) }));
    if (collegeIdFilter) {
      colleges = colleges.filter((c) => c.id === collegeIdFilter);
    } else if (locationIdFilter) {
      colleges = colleges.filter((c) => c.locationId === locationIdFilter);
    }

    const perCollege = await Promise.all(
      colleges.map(async (c) => {
        const [indentSnap, clearanceSnap] = await Promise.all([
          db.collection("colleges").doc(c.id).collection("indentRequests").get(),
          db.collection("colleges").doc(c.id).collection("financePurchaseClearance").get(),
        ]);

        const meta = {
          collegeId: c.id,
          collegeName: c.name ?? c.id,
          locationId: c.locationId ?? "",
          locationName: c.locationId ? (locationNames.get(c.locationId) ?? c.locationId) : "",
        };

        let indents = indentSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object), ...meta }) as IndentRequest & typeof meta);
        if (status) indents = indents.filter((r) => r.status === status);
        if (requestType) indents = indents.filter((r) => r.requestType === requestType);

        let clearances = clearanceSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object), ...meta }) as FinancePurchaseClearance & typeof meta);
        if (status) clearances = clearances.filter((r) => r.status === status);

        return { indents, clearances };
      })
    );

    const indents = perCollege.flatMap((r) => r.indents).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    const clearances = perCollege.flatMap((r) => r.clearances).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    return NextResponse.json({ indents, clearances });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[purchase/indents/overview GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
