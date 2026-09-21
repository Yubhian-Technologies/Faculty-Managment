export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { assignSeat, listSeats } from "@/lib/roles/seats";

// The three people Location Administration is responsible for at a college.
const HEAD_OFFICE_MANAGED = ["COLLEGE_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];

async function loadTarget(collegeId: string | null, uid: string, locationId: string) {
  if (!collegeId) return { error: "collegeId is required", status: 400 as const };
  const db = getAdminDb();
  const collegeSnap = await db.collection("colleges").doc(collegeId).get();
  if (!collegeSnap.exists) return { error: "College not found", status: 404 as const };
  if ((collegeSnap.data() as { locationId?: string }).locationId !== locationId) {
    return { error: "College does not belong to your location", status: 403 as const };
  }
  const userRef = db.collection("colleges").doc(collegeId).collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { error: "User not found", status: 404 as const };
  const user = userSnap.data() as { role?: string; seatRoles?: string[]; name?: string; email?: string; collegeEmail?: string };
  const held = [user.role ?? "", ...(user.seatRoles ?? [])];
  if (!held.some((r) => HEAD_OFFICE_MANAGED.includes(r))) {
    return { error: "Only a College Admin, Principal or Vice Principal can be managed from here", status: 403 as const };
  }
  return { db, collegeId, userRef, user };
}

function handleError(err: unknown, tag: string) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/email-already-exists") return NextResponse.json({ error: "That email is already used by another account" }, { status: 409 });
  if (code === "auth/invalid-email") return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  if (code === "auth/invalid-password") return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  console.error(`[administration/college-people/[uid] ${tag}]`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { uid } = await params;
    const body = (await request.json()) as { collegeId?: string; name?: string; phone?: string; collegeEmail?: string; newPassword?: string };
    const t = await loadTarget(body.collegeId ?? null, uid, session.locationId);
    if ("error" in t) return NextResponse.json({ error: t.error }, { status: t.status });

    if (body.newPassword !== undefined && body.newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const email = body.collegeEmail?.trim().toLowerCase();
    if (body.collegeEmail !== undefined && !email) {
      return NextResponse.json({ error: "Email can't be empty" }, { status: 400 });
    }

    const auth = await getAdminAuth();
    const authUpdate: { email?: string; password?: string; displayName?: string } = {};
    if (email && email !== (t.user.collegeEmail ?? t.user.email)) authUpdate.email = email;
    if (body.newPassword) authUpdate.password = body.newPassword;
    const name = body.name?.trim();
    if (name) authUpdate.displayName = name;
    if (Object.keys(authUpdate).length) await auth.updateUser(uid, authUpdate);
    if (body.newPassword) await auth.revokeRefreshTokens(uid);

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (name) updates.name = name;
    if (body.phone !== undefined) updates.phone = body.phone.trim();
    if (email) { updates.email = email; updates.collegeEmail = email; }
    await t.userRef.update(updates);
    if (name || email) {
      await t.db.collection("systemUsers").doc(uid).set({ ...(name ? { name } : {}), ...(email ? { email } : {}) }, { merge: true });
    }

    await t.db.collection("colleges").doc(t.collegeId).collection("auditLogs").add({
      collegeId: t.collegeId, action: "USER_UPDATED",
      performedBy: session.uid, performedByName: "Administration",
      targetId: uid, details: { role: t.user.role, by: "location-admin", passwordReset: !!body.newPassword }, timestamp: now,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err, "PATCH");
  }
}

// Removes the person's access. Any seat they hold is vacated first (kept in its
// history) so the college can appoint someone else. A login that exists only
// for this role is deleted outright; one that's also a real member of the
// faculty/staff roster is switched off instead, so nothing linked to them
// dangles.
export async function DELETE(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { uid } = await params;
    const collegeId = new URL(request.url).searchParams.get("collegeId");
    const t = await loadTarget(collegeId, uid, session.locationId);
    if ("error" in t) return NextResponse.json({ error: t.error }, { status: t.status });

    const actor = { uid: session.uid, name: "Administration" };
    const seats = await listSeats(t.db, t.collegeId);
    for (const seat of seats.filter((s) => s.holderUid === uid)) {
      await assignSeat(t.db, t.collegeId, seat.id, { uid: null, outgoing: { action: "DEACTIVATE" }, note: "Removed by Administration" }, actor);
    }

    const col = t.db.collection("colleges").doc(t.collegeId);
    const [fac, sup] = await Promise.all([
      col.collection("facultyMembers").where("userUid", "==", uid).limit(1).get(),
      col.collection("supportingStaff").where("userUid", "==", uid).limit(1).get(),
    ]);
    const onRoster = !fac.empty || !sup.empty;

    const auth = await getAdminAuth();
    const now = new Date();
    if (onRoster) {
      await t.userRef.update({ isActive: false, updatedAt: now });
      await auth.updateUser(uid, { disabled: true }).catch(() => {});
      await auth.revokeRefreshTokens(uid).catch(() => {});
    } else {
      await auth.deleteUser(uid).catch((e: { code?: string }) => { if (e.code !== "auth/user-not-found") throw e; });
      await t.userRef.delete();
      await t.db.collection("systemUsers").doc(uid).delete().catch(() => {});
    }

    await col.collection("auditLogs").add({
      collegeId: t.collegeId, action: onRoster ? "USER_DEACTIVATED" : "USER_DELETED",
      performedBy: session.uid, performedByName: "Administration",
      targetId: uid, details: { role: t.user.role, name: t.user.name, by: "location-admin" }, timestamp: now,
    });
    return NextResponse.json({ ok: true, mode: onRoster ? "deactivated" : "deleted" });
  } catch (err) {
    return handleError(err, "DELETE");
  }
}
