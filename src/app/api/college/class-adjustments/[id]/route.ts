export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actOn, AdjustmentError, type Action } from "@/lib/classAdjustments/server";
import { callerOf, errorResponse } from "@/lib/classAdjustments/routeHelpers";

// POST { action: "ACCEPT" | "DECLINE" | "CANCEL", reason? }
//   ACCEPT / DECLINE: the colleague asked. CANCEL: either faculty member or an HOD of the section's department,
//   while no attendance has been taken under it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { action?: unknown; reason?: unknown };
    const action = body.action;
    if (action !== "ACCEPT" && action !== "DECLINE" && action !== "CANCEL") throw new AdjustmentError("Select Accept, Decline or Cancel.");
    const db = getAdminDb();
    const caller = await callerOf(db, session);
    const status = await actOn(db, session.collegeId, id, action as Action, caller, typeof body.reason === "string" ? body.reason : undefined);
    return NextResponse.json({ status });
  } catch (err) {
    return errorResponse(err, "class-adjustments/[id] POST");
  }
}
