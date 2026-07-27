export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { EmployeeLeaveProfile, LeaveEmploymentType } from "@/types/leave";
import type { FacultyMember } from "@/types/core";
import { PROFILES_COL, initBalancesForYear } from "@/lib/leave/balanceEngine";

// A faculty member's employment type, gender, marital status, date of joining
// and department are already set by HR/admin when the FacultyMember record was
// created — the leave profile must mirror them, not let the faculty redefine
// them during self-service setup.
function facultyDefaults(faculty: FirebaseFirestore.DocumentData) {
  const f = faculty as Partial<FacultyMember>;
  const defaults: Partial<EmployeeLeaveProfile> = {};

  if (f.employmentType) {
    const employmentType: LeaveEmploymentType = f.employmentType === "PERMANENT" ? "permanent" : "probation";
    defaults.employmentType = employmentType;
  }
  if (f.gender) {
    defaults.gender = f.gender.toLowerCase() as EmployeeLeaveProfile["gender"];
  }
  if (f.maritalStatus) {
    defaults.maritalStatus = f.maritalStatus === "Married" ? "married" : "unmarried";
  }
  if (f.joiningDate) {
    defaults.dateOfJoining = f.joiningDate as EmployeeLeaveProfile["dateOfJoining"];
  }
  if (f.department) {
    defaults.department = f.department;
  }
  return defaults;
}

async function loadFacultyDefaults(
  db: ReturnType<typeof getAdminDb>,
  collegeId: string,
  uid: string
): Promise<Partial<EmployeeLeaveProfile> | null> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("facultyMembers")
    .where("userUid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return facultyDefaults(snap.docs[0].data());
}

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

    // Pre-fill (and let the client lock) the fields HR already set on the
    // faculty record, for a faculty member setting up their own profile.
    const facultyDefaultsForSelf =
      resolvedUid === session.uid && session.role === "PANEL_MEMBER"
        ? await loadFacultyDefaults(db, session.collegeId, resolvedUid)
        : null;

    if (!snap.exists) return NextResponse.json({ profile: null, facultyDefaults: facultyDefaultsForSelf });
    return NextResponse.json({ profile: { id: snap.id, ...snap.data() }, facultyDefaults: facultyDefaultsForSelf });
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

    // A faculty member setting up their own profile cannot override the
    // employment details HR already recorded — enforce it server-side
    // regardless of what the client sends.
    if (resolvedUid === session.uid && session.role === "PANEL_MEMBER") {
      const locked = await loadFacultyDefaults(db, session.collegeId, resolvedUid);
      if (locked) Object.assign(body, locked);
    }

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
