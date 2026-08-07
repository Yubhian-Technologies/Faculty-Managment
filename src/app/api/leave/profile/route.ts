export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { PROFILES_COL, initBalancesForYear } from "@/lib/leave/balanceEngine";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import type { EmployeeLeaveProfile, StaffCategory } from "@/types/leave";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
    );
    const targetUid = new URL(request.url).searchParams.get("uid") || session.uid;

    const db = getAdminDb();
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, targetUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profile = await getOrCreateProfile(db, session.collegeId, targetUid);
    if (!profile) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const settings = await loadCollegeSettings(db, session.collegeId);
    const effectiveCategory = computeEffectiveCategory(profile, settings.newJoiningYears);

    const year = new Date().getFullYear();
    await initBalancesForYear(db, session.collegeId, targetUid, profile, settings.newJoiningYears, year);

    return NextResponse.json({ profile, effectiveCategory, newJoiningYears: settings.newJoiningYears });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profile GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// HOD (own dept) / Principal / Vice Principal override a profile's category
// defaults - e.g. correcting an auto-derived isTeachingStaff/dateOfJoining, or
// manually re-categorizing vacation <-> non-vacation.
export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as {
      uid?: string;
      staffCategory?: StaffCategory;
      isTeachingStaff?: boolean;
      dateOfJoining?: string;
    };
    if (!body.uid) {
      return NextResponse.json({ error: "uid is required" }, { status: 400 });
    }

    const db = getAdminDb();
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, body.uid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profileRef = PROFILES_COL(session.collegeId, db).doc(body.uid);
    const snap = await profileRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Profile not found - load it via GET first" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.staffCategory) updates.staffCategory = body.staffCategory;
    if (body.isTeachingStaff !== undefined) updates.isTeachingStaff = body.isTeachingStaff;
    if (body.dateOfJoining) updates.dateOfJoining = new Date(body.dateOfJoining);

    await profileRef.update(updates);

    const updatedSnap = await profileRef.get();
    const profile = { id: updatedSnap.id, ...updatedSnap.data() } as EmployeeLeaveProfile;
    const settings = await loadCollegeSettings(db, session.collegeId);
    const year = new Date().getFullYear();
    await initBalancesForYear(db, session.collegeId, body.uid, profile, settings.newJoiningYears, year);

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profile PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
