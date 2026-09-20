export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { forgetHeldRoles } from "@/lib/auth/liveRoles";
import { assignSeat, deactivateSeat, listSeatHistory, SeatError, seatsCol, updateSeat } from "@/lib/roles/seats";
import { assertCanAssign, requireSeatManager } from "@/lib/roles/seatContext";
import type { OutgoingHolderAction, RoleSeat } from "@/types/roleSeats";

// One seat: GET its holder history; PATCH to assign / vacate / edit / remove it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSeatManager(request);
    return NextResponse.json({ history: await listSeatHistory(getAdminDb(), ctx.collegeId, id) });
  } catch (err) {
    return handle(err, "GET");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSeatManager(request);
    const db = getAdminDb();
    const body = (await request.json()) as {
      action?: "ASSIGN" | "VACATE" | "UPDATE" | "REMOVE";
      uid?: string;
      outgoing?: OutgoingHolderAction;
      note?: string;
      roleEmail?: string | null;
      label?: string;
    };

    const seatSnap = await seatsCol(db, ctx.collegeId).doc(id).get();
    if (!seatSnap.exists) return NextResponse.json({ error: "Seat not found" }, { status: 404 });
    const seat = { id: seatSnap.id, ...seatSnap.data() } as RoleSeat;
    assertCanAssign(ctx, seat.role);
    const previousHolder = seat.holderUid;

    if (body.action === "ASSIGN") {
      if (!body.uid) return NextResponse.json({ error: "Pick the person to put in this seat" }, { status: 400 });
      await assignSeat(db, ctx.collegeId, id, { uid: body.uid, outgoing: body.outgoing, note: body.note }, ctx.actor);
    } else if (body.action === "VACATE") {
      await assignSeat(db, ctx.collegeId, id, { uid: null, outgoing: body.outgoing }, ctx.actor);
    } else if (body.action === "UPDATE") {
      await updateSeat(db, ctx.collegeId, id, { roleEmail: body.roleEmail, label: body.label }, ctx.actor);
    } else if (body.action === "REMOVE") {
      await deactivateSeat(db, ctx.collegeId, id, ctx.actor);
    } else {
      return NextResponse.json({ error: "action must be ASSIGN, VACATE, UPDATE or REMOVE" }, { status: 400 });
    }

    // Take effect immediately for everyone involved, not after the cache window.
    if (previousHolder) forgetHeldRoles(ctx.collegeId, previousHolder);
    if (body.uid) forgetHeldRoles(ctx.collegeId, body.uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handle(err, "PATCH");
  }
}

function handle(err: unknown, method: string) {
  if (err instanceof SeatError) {
    const needsOutgoing = err.message === "OUTGOING_ACTION_REQUIRED";
    return NextResponse.json(
      {
        error: needsOutgoing ? "Choose what happens to the current holder's account" : err.message,
        ...(needsOutgoing ? { code: "OUTGOING_ACTION_REQUIRED" } : {}),
      },
      { status: err.status }
    );
  }
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(`[college/role-seats/[id] ${method}]`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
