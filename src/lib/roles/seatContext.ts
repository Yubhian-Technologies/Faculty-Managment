import { requireRole, type SessionPayload } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAssignSeat } from "@/lib/roles/seatRoles";
import { SeatError, type SeatActor } from "@/lib/roles/seats";

export interface SeatRequestContext {
  session: SessionPayload;
  collegeId: string;
  actor: SeatActor;
}

// Who may manage seats, and for which college: the Principal / Vice Principal
// / College Admin for their own college, and Super Admin / Management / the
// location's Administration for any college they name with ?collegeId= (an
// Administration login only for colleges in its own location). What each of
// them may assign is decided per seat by canAssignSeat.
export async function requireSeatManager(request: Request): Promise<SeatRequestContext> {
  const session = await requireRole("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "MANAGEMENT", "ADMINISTRATION");
  const db = getAdminDb();

  let collegeId = session.collegeId;
  if (!collegeId) {
    collegeId = new URL(request.url).searchParams.get("collegeId") ?? "";
    if (!collegeId) throw new SeatError("collegeId is required");
    if (session.role === "ADMINISTRATION") {
      const college = await db.collection("colleges").doc(collegeId).get();
      if (!college.exists || (college.data() as { locationId?: string }).locationId !== session.locationId) {
        throw new SeatError("That college isn't in your location", 403);
      }
    }
  }

  let name = session.email || "Unknown";
  if (session.collegeId) {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
    name = (snap.data() as { name?: string } | undefined)?.name ?? name;
  }
  return { session, collegeId, actor: { uid: session.uid, name } };
}

export function assertCanAssign(ctx: SeatRequestContext): void {
  if (!canAssignSeat(ctx.session)) {
    throw new SeatError("You can't assign this seat", 403);
  }
}
