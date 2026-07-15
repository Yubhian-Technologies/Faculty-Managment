export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import type { UserRole } from "@/types";
import { ROLE_SCOPE } from "@/types";

export async function GET(request: Request) {
  try {
    await requireRole("SUPER_ADMIN");

    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    const scope = searchParams.get("scope");

    const db = getAdminDb();

    if (scope === "global") {
      // System-wide users (e.g. MANAGEMENT) have no college/location scope — they live only in systemUsers.
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

    const users = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));
    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Roles a Super Admin can create — the level L1–L3 set. Each role's write target
// (systemUsers / locationUsers / college users) is derived from ROLE_SCOPE, so the
// single source of truth stays in core.ts. L4–L6 (HOD, Office, Faculty, Student) are
// provisioned by Principals/HODs via their own routes, not here.
const SUPER_ADMIN_CREATABLE: UserRole[] = [
  "MANAGEMENT", "FINANCE", "PURCHASE_DEPT",   // L1 · GLOBAL
  "ADMINISTRATION", "ACCOUNTS",               // L2 · LOCATION
  "PRINCIPAL", "VICE_PRINCIPAL",              // L3 · COLLEGE
];
// Global-scoped subset — used by the GET ?scope=global (System-Wide) listing.
const GLOBAL_ROLES: UserRole[] = SUPER_ADMIN_CREATABLE.filter((r) => ROLE_SCOPE[r] === "GLOBAL");

// MANAGEMENT (L1) can appoint Administrators/Accounts to a location — the
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
    } & PersonalDetailsInput;

    const { name, email, password, role, collegeId, locationId, department, phone, academicProfile } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

    // Create Firebase Auth user via REST API (no firebase-admin/auth needed)
    const uid = await createFirebaseUser(email, password, name);
    const now = new Date();

    if (scope === "GLOBAL") {
      // MANAGEMENT / FINANCE / PURCHASE_DEPT: no college/location scope — systemUsers only.
      await db.collection("systemUsers").doc(uid).set({
        uid, role, email, name, phone: phone ?? "", collegeId: "", isActive: true, createdAt: now,
      });
    } else if (scope === "LOCATION" && locationId) {
      // ADMINISTRATION / ACCOUNTS: location subcollection.
      await db.collection("locations").doc(locationId).collection("locationUsers").doc(uid).set({
        uid, locationId, name, email, role,
        isActive: true, createdAt: now, updatedAt: now,
      });
      await db.collection("systemUsers").doc(uid).set({ uid, role, locationId, collegeId: "", email, name });
    } else if (scope === "COLLEGE" && collegeId) {
      // PRINCIPAL / VICE_PRINCIPAL: college subcollection.
      await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
        uid, collegeId,
        ...(collegeLocationId ? { locationId: collegeLocationId } : {}),
        name, email, role,
        department: department ?? "",
        ...(academicProfile ? { academicProfile } : {}),
        ...buildPersonalDetailsUpdate(body),
        isActive: true, createdAt: now, updatedAt: now,
      });
      await db.collection("systemUsers").doc(uid).set({
        uid, role, collegeId,
        ...(collegeLocationId ? { locationId: collegeLocationId } : {}),
        email, name,
      });
      await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
        collegeId, action: "USER_CREATED",
        performedBy: session.uid, performedByName: session.role,
        targetId: uid, details: { email, role, name }, timestamp: now,
      });
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
