export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { convertLegacyAccounts, createSeat, listSeats, SeatError } from "@/lib/roles/seats";
import { assertCanAssign, requireSeatManager } from "@/lib/roles/seatContext";
import { SEAT_ROLES, normalizeStoredRole } from "@/lib/roles/seatRoles";

// Role seats for the college - see types/roleSeats.ts. GET returns the seats
// plus the people who can be put in one; POST creates an (empty) seat.
export async function GET(request: Request) {
  try {
    const ctx = await requireSeatManager(request);
    const db = getAdminDb();

    // Existing role logins (HOD, Principal, VP, ...) become seats the first
    // time anyone opens this page - nobody has to click anything. Idempotent,
    // and marked on the college so it only runs once; anything created later
    // is converted by the account-creation hooks.
    const collegeRef = db.collection("colleges").doc(ctx.collegeId);
    const collegeSnap = await collegeRef.get();
    if (!(collegeSnap.data() as { seatsConvertedAt?: unknown } | undefined)?.seatsConvertedAt) {
      await convertLegacyAccounts(db, ctx.collegeId, ctx.actor);
      await collegeRef.set({ seatsConvertedAt: new Date() }, { merge: true });
    }

    const [seats, usersSnap, deptsSnap] = await Promise.all([
      listSeats(db, ctx.collegeId),
      db.collection("colleges").doc(ctx.collegeId).collection("users").get(),
      db.collection("colleges").doc(ctx.collegeId).collection("departments").get(),
    ]);

    // Anyone who isn't a student can hold a seat - always by their own personal
    // login, so this is a list of people, not of role accounts.
    const people = usersSnap.docs
      .map((d) => {
        const u = d.data() as { name?: string; email?: string; collegeEmail?: string; role?: string; department?: string; isActive?: boolean };
        return {
          uid: d.id, name: u.name ?? "Unknown", email: u.collegeEmail || u.email || "",
          role: normalizeStoredRole(u.role ?? ""), storedRole: u.role ?? "", department: u.department ?? "", isActive: u.isActive,
        };
      })
      .filter((p) => p.isActive !== false && p.role !== "STUDENT" && p.role !== "CLASS_LEADER")
      .map((p) => ({ uid: p.uid, name: p.name, email: p.email, role: p.role, storedRole: p.storedRole, department: p.department }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const departments = deptsSnap.docs
      .map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ seats, people, departments });
  } catch (err) {
    return handle(err, "GET");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSeatManager(request);
    const body = (await request.json()) as { role?: string; departmentId?: string; label?: string; roleEmail?: string };
    if (!body.role || !(SEAT_ROLES as string[]).includes(body.role)) {
      return NextResponse.json({ error: "Pick a valid role for the seat" }, { status: 400 });
    }
    assertCanAssign(ctx);
    const id = await createSeat(getAdminDb(), ctx.collegeId, { ...body, role: body.role }, ctx.actor);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return handle(err, "POST");
  }
}

function handle(err: unknown, method: string) {
  if (err instanceof SeatError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(`[college/role-seats ${method}]`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
