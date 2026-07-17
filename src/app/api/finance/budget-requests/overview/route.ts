export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeBudgetRequest, type BudgetRequest } from "@/types";

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

// Cross-college view for FINANCE — a GLOBAL role serving every college across
// every location, so its "all budget requests" view needs to fan out over
// every college's budgetRequests subcollection instead of the single-collegeId
// scope /api/college/budget-requests uses.
//
// Deliberately NOT a collectionGroup(...) query — see the identical precedent/
// rationale in src/app/api/management/emergency-budget-requests/route.ts:
// collection-group scope needs an explicitly deployed index per queried field,
// which budgetRequests never had, so that query would throw FAILED_PRECONDITION
// in production. Querying each college's subcollection directly is a plain
// collection-scoped filter, indexed automatically.
export async function GET(request: Request) {
  try {
    await requireRole("FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const locationIdFilter = searchParams.get("locationId");
    const collegeIdFilter = searchParams.get("collegeId");
    const status = searchParams.get("status");
    const isEmergencyFilter = searchParams.get("isEmergency"); // "true" | "false"

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
        const snap = await db.collection("colleges").doc(c.id).collection("budgetRequests").get();

        const meta = {
          collegeId: c.id,
          collegeName: c.name ?? c.id,
          locationId: c.locationId ?? "",
          locationName: c.locationId ? (locationNames.get(c.locationId) ?? c.locationId) : "",
        };

        let requests = snap.docs.map((d) => {
          const req = normalizeBudgetRequest({ id: d.id, ...d.data() } as BudgetRequest);
          return { ...req, ...meta };
        });

        if (status) requests = requests.filter((r) => r.status === status);
        if (isEmergencyFilter) requests = requests.filter((r) => !!r.isEmergency === (isEmergencyFilter === "true"));

        return requests;
      })
    );

    const requests = perCollege.flat().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[finance/budget-requests/overview GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
