export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { EmployeeLeaveProfile } from "@/types/leave";
import { PROFILES_COL, initBalancesForYear } from "@/lib/leave/balanceEngine";

// ─── GET — fetch profile (own, or specific uid for HOD/Principal) ─────────────

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const targetUid = searchParams.get("uid");

    // Only HOD, Principal and above can view another person's profile
    const resolvedUid =
      targetUid &&
      ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN"].includes(session.role)
        ? targetUid
        : session.uid;

    const db = getAdminDb();
    const snap = await PROFILES_COL(session.collegeId, db).doc(resolvedUid).get();

    if (!snap.exists) return NextResponse.json({ profile: null });
    return NextResponse.json({ profile: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profile GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── PUT — create/update profile (own, or specific uid for HOD/Principal) ─────

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const targetUid = searchParams.get("uid");

    const canManageOthers = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN"].includes(session.role);
    const resolvedUid = targetUid && canManageOthers ? targetUid : session.uid;

    const body = (await request.json()) as Partial<EmployeeLeaveProfile>;

    const db = getAdminDb();
    const ref = PROFILES_COL(session.collegeId, db).doc(resolvedUid);
    const existing = await ref.get();
    const now = new Date();

    const isNew = !existing.exists;

    if (isNew) {
      await ref.set({
        ...body,
        id: resolvedUid,
        uid: resolvedUid,
        collegeId: session.collegeId,
        maternityLeaveUsedOnce: body.maternityLeaveUsedOnce ?? false,
        livingChildrenCount: body.livingChildrenCount ?? 0,
        isConfirmed: body.isConfirmed ?? false,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ref.update({ ...body, updatedAt: now });
    }

    const updated = await ref.get();
    const savedProfile = { id: updated.id, ...updated.data() } as EmployeeLeaveProfile;

    // Auto-initialize balances for the current year on new profile creation
    if (isNew) {
      try {
        await initBalancesForYear(db, session.collegeId, resolvedUid, savedProfile, new Date().getFullYear());
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ profile: savedProfile });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profile PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
