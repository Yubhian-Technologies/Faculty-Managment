export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { convertLegacyAccounts, SeatError } from "@/lib/roles/seats";
import { requireSeatManager } from "@/lib/roles/seatContext";

// One-time (and safe to repeat) migration: every existing HOD / Vice Principal
// / Dean / ... login becomes a seat held by that account, so a real person can
// be appointed to it afterwards. See convertLegacyAccounts.
export async function POST(request: Request) {
  try {
    const ctx = await requireSeatManager(request);
    const result = await convertLegacyAccounts(getAdminDb(), ctx.collegeId, ctx.actor);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SeatError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/role-seats/convert-legacy POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
