export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { candidates, filledOf, slotContext } from "@/lib/invigilation/context";
import { INVIGILATION_READ_ROLES, invigilationError, loadSchedule } from "@/lib/invigilation/server";

// Every faculty member judged for one duty (?slot=) - or for a whole session
// (?session=, the Free Faculty view: no room, no subject) - with the reasons
// someone can't take it, their workload and rooms so far, fairest first.
// ?replacing=<dutyId> judges people as the replacement of that duty.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...INVIGILATION_READ_ROLES);
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const db = getAdminDb();
    const schedule = await loadSchedule(db, session.collegeId, id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    const ctx = await slotContext(db, session.collegeId, schedule, { slotKey: q.get("slot") ?? undefined, session: q.get("session") ?? undefined });
    if (!ctx) return NextResponse.json({ error: "That duty is no longer in the schedule - reload" }, { status: 404 });
    return NextResponse.json({
      slot: { ...ctx.slot, filled: q.get("session") ? 0 : filledOf(ctx) },
      candidates: candidates(ctx, schedule, { replacing: q.get("replacing") ?? undefined }),
    });
  } catch (err) {
    return invigilationError(err, "[invigilation/candidates GET]");
  }
}
