export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import type { LeaveRequest } from "@/types/leave";

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

// MANAGEMENT is a global role with no college context of its own (see
// requireManagement()'s comment in verifySession.ts) - a Principal's own
// leave (PENDING_MANAGEMENT, see applications/route.ts POST) is the one
// leave-module decision Management makes, so this fans out across every
// college's leaveRequests subcollection rather than scoping to one, same
// idiom as management/emergency-budget-requests/route.ts (plain
// collection-scoped equality filters, no collectionGroup index needed).
export async function GET() {
  try {
    await requireManagement();

    const db = getAdminDb();
    const collegesSnap = await db.collection("colleges").get();
    const collegeNames = new Map(collegesSnap.docs.map((d) => [d.id, (d.data() as { name?: string }).name ?? d.id]));

    const perCollege = await Promise.all(
      collegesSnap.docs.map(async (c) => {
        const snap = await REQUESTS_COL(c.id, db).where("status", "==", "PENDING_MANAGEMENT").get();
        return snap.docs.map((d) => {
          const req = { id: d.id, ...d.data() } as LeaveRequest;
          return { ...req, collegeId: c.id, collegeName: collegeNames.get(c.id) ?? c.id };
        });
      })
    );

    const requests = perCollege
      .flat()
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/leave-approvals GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
