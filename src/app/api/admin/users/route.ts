export const dynamic = "force-dynamic";

import { convertLegacyAccounts } from "@/lib/roles/seats";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { provisionCollegeUser, provisionLocationUser } from "@/lib/firestore/userProvisioning";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateUserDoc, migrateFacultyDoc, migrateSupportingStaffDoc } from "@/lib/faculty/fieldRenames";
import { PHONE_REGEX } from "@/lib/validations";
import type { UserRole } from "@/types";
import { ROLE_SCOPE } from "@/types";

export async function GET(request: Request) {
  try {
    await requireRole("SUPER_ADMIN");

    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    const scope = searchParams.get("scope");
    const departmentFilter = searchParams.get("department")?.trim() ?? "";

    const db = getAdminDb();

    if (scope === "global") {
      // System-wide users (e.g. MANAGEMENT) have no college/location scope - they live only in systemUsers.
      const snap = await db.collection("systemUsers").where("role", "in", GLOBAL_ROLES).get();
      const users = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));
      return NextResponse.json({ users });
    }

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const snap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .get();

    // PANEL_MEMBER (faculty) and COLLEGE_STAFF (supporting staff) login docs
    // only ever store a thin subset (name/email/role/department/isActive) -
    // their real details (designation, employeeId, phone, qualifications,
    // joiningDate, ...) live on the linked facultyMembers/supportingStaff
    // record (see src/app/api/college/faculty/[id]/login/route.ts and
    // src/app/api/college/supporting-staff/route.ts). Merge that record in
    // here so this list (and the "Download resume" button, which just sends
    // the row as-is) has the full picture instead of only login-account fields.
    const usersRaw = snap.docs.map((d) => ({ uid: d.id, ...migrateUserDoc(d.data()) })) as (Record<string, unknown> & { uid: string; role?: string })[];
    const users = await Promise.all(
      usersRaw.map(async (u) => {
        let linkedCollection: string | null = null;
        if (u.role === "PANEL_MEMBER") linkedCollection = "facultyMembers";
        else if (u.role === "COLLEGE_STAFF") linkedCollection = "supportingStaff";
        if (!linkedCollection) return u;

        const linkedSnap = await db.collection("colleges").doc(collegeId).collection(linkedCollection)
          .where("userUid", "==", u.uid).limit(1).get();
        if (linkedSnap.empty) return u;
        const linkedData = linkedSnap.docs[0].data();
        const linkedLifted = linkedCollection === "facultyMembers" ? migrateFacultyDoc(linkedData) : migrateSupportingStaffDoc(linkedData);
        return { ...linkedLifted, ...u, recordId: linkedSnap.docs[0].id };
      })
    );
    let filteredUsers = users;
    if (departmentFilter) {
      filteredUsers = users.filter((u) => {
        const rec = u as Record<string, unknown> & { department?: string; departments?: string[] };
        const depts = rec.departments && rec.departments.length > 0 ? rec.departments : [rec.department].filter(Boolean) as string[];
        return depts.includes(departmentFilter);
      });
    }
    filteredUsers.sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));
    return NextResponse.json({ users: filteredUsers });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Roles a Super Admin can create - the level L1–L2 set plus DIRECTOR (L3).
// Each role's write target (systemUsers / locationUsers / college users) is
// derived from ROLE_SCOPE, so the single source of truth stays in core.ts.
// Principal and the rest of L3 and below are seats - a college's own College
// Admin appoints them via Role Assignments, never Super Admin directly (same
// reasoning as removing it from Location Admin). Must match CREATABLE_ROLES in
// super-admin/users/new/page.tsx.
const SUPER_ADMIN_CREATABLE: UserRole[] = [
  "MANAGEMENT", "FINANCE", "PURCHASE_DEPT",   // L1 · GLOBAL
  "ADMINISTRATION", "ACCOUNTS",               // L2 · LOCATION
  "DIRECTOR",                                 // L3 · COLLEGE
];
// Global-scoped subset - used by the GET ?scope=global (System-Wide) listing.
const GLOBAL_ROLES: UserRole[] = SUPER_ADMIN_CREATABLE.filter((r) => ROLE_SCOPE[r] === "GLOBAL");

// MANAGEMENT (L1) can appoint Administrators/Accounts to a location - the
// LOCATION-scoped slice of SUPER_ADMIN_CREATABLE.
const MANAGEMENT_CREATABLE: UserRole[] = ["ADMINISTRATION", "ACCOUNTS"];

export async function POST(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "MANAGEMENT");
    const creatableRoles = session.role === "MANAGEMENT" ? MANAGEMENT_CREATABLE : SUPER_ADMIN_CREATABLE;

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      collegeId?: string;
      locationId?: string;
      department?: string;
      phone?: string;
      academicProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const { name, email, password, role, collegeId, locationId, department, phone, academicProfile, profilePhotoUrl } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Optional, but a filled-in value must be a real 10-digit mobile number -
    // the client already enforces this (super-admin/users/new/page.tsx), this
    // is the server-side backstop for any other caller of this route.
    if (phone && !PHONE_REGEX.test(phone.trim())) {
      return NextResponse.json({ error: "Phone must be exactly 10 digits, starting with 6, 7, 8 or 9" }, { status: 400 });
    }
    // Uploaded before the account exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific uid.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    if (!creatableRoles.includes(role)) {
      return NextResponse.json(
        { error: `${session.role === "MANAGEMENT" ? "Management" : "Super Admin"} can create: ${creatableRoles.join(", ")}` },
        { status: 403 }
      );
    }

    const scope = ROLE_SCOPE[role]; // GLOBAL | LOCATION | COLLEGE
    if (scope === "COLLEGE" && !collegeId) {
      return NextResponse.json({ error: "collegeId required for this role" }, { status: 400 });
    }
    if (scope === "LOCATION" && !locationId) {
      return NextResponse.json({ error: "locationId required for this role" }, { status: 400 });
    }

    const db = getAdminDb();

    // For college roles, validate the college exists and belongs to the selected
    // location (the wizard cascades location → college; keep them consistent).
    let collegeLocationId = "";
    if (scope === "COLLEGE" && collegeId) {
      const collegeSnap = await db.collection("colleges").doc(collegeId).get();
      if (!collegeSnap.exists) {
        return NextResponse.json({ error: "Selected college not found" }, { status: 400 });
      }
      collegeLocationId = (collegeSnap.data() as { locationId?: string })?.locationId ?? "";
      if (locationId && collegeLocationId && collegeLocationId !== locationId) {
        return NextResponse.json(
          { error: "Selected college does not belong to the selected location" },
          { status: 400 }
        );
      }
    }

    let uid: string;

    if (scope === "GLOBAL") {
      // MANAGEMENT / FINANCE / PURCHASE_DEPT: no college/location scope - systemUsers only.
      uid = await createFirebaseUser(email, password, name);
      await db.collection("systemUsers").doc(uid).set({
        uid, role, email, name, phone: phone ?? "", collegeId: "",
        ...(academicProfile ? { academicProfile: normalizeAcademicProfile(academicProfile) } : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true, createdAt: new Date(),
      });
    } else if (scope === "LOCATION" && locationId) {
      // ADMINISTRATION / ACCOUNTS: location subcollection.
      uid = await provisionLocationUser(db, locationId, role, { name, email, password, phone, academicProfile, profilePhotoUrl });
    } else if (scope === "COLLEGE" && collegeId) {
      // DIRECTOR: college subcollection.
      uid = await provisionCollegeUser(
        db, collegeId, role,
        { ...body, name, email, password, phone, department, academicProfile, profilePhotoUrl },
        { locationId: collegeLocationId, performedBy: session.uid, performedByRole: session.role }
      );
    } else {
      return NextResponse.json({ error: "Invalid role scope" }, { status: 400 });
    }

    if (collegeId) {
      await convertLegacyAccounts(db, collegeId, { uid: session.uid, name: "Super Admin" })
        .catch((e) => console.error("[admin/users POST] seat conversion failed:", e));
    }

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/users POST]", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
