export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";
import { feeRefs } from "@/lib/fees/server";
import type { FeeConcessionRequest } from "@/types/fees";

// Management > Fee Concessions: the College Offices' concession requests across every college.
// GET ?status=PENDING|DECIDED   (one equality query per college - no collection-group index needed)
export async function GET(request: Request) {
  try {
    await requireManagement();
    const db = getAdminDb();
    const decided = new URL(request.url).searchParams.get("status") === "DECIDED";
    const colleges = await db.collection("colleges").get();
    const lists = await Promise.all(colleges.docs.map(async (c) => {
      const col = feeRefs(db, c.id).concessionRequests;
      const snap = decided ? await col.where("status", "in", ["APPROVED", "REJECTED"]).get() : await col.where("status", "==", "PENDING").get();
      return snap.docs.map((d) => d.data() as FeeConcessionRequest);
    }));
    const requests = lists.flat().sort((a, b) => (decided ? (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "") : a.requestedAt.localeCompare(b.requestedAt))).slice(0, decided ? 200 : 500);
    return NextResponse.json({ requests });
  } catch (err) {
    return paymentErrorResponse(err, "[management/fee-concessions GET]");
  }
}
