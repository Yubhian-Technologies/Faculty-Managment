export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import type { UserRole } from "@/types";

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();

    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();
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

const COLLEGE_ROLES: UserRole[] = ["PRINCIPAL", "VICE_PRINCIPAL", "ACCOUNTS"];
const LOCATION_ROLES: UserRole[] = ["ADMINISTRATION"];

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      collegeId?: string;
      locationId?: string;
      department?: string;
    };

    const { name, email, password, role, collegeId, locationId, department } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const isCollegeRole = COLLEGE_ROLES.includes(role);
    const isLocationRole = LOCATION_ROLES.includes(role);

    if (!isCollegeRole && !isLocationRole) {
      return NextResponse.json(
        { error: `Super Admin can create: ${[...COLLEGE_ROLES, ...LOCATION_ROLES].join(", ")}` },
        { status: 403 }
      );
    }
    if (isCollegeRole && !collegeId) {
      return NextResponse.json({ error: "collegeId required for this role" }, { status: 400 });
    }
    if (isLocationRole && !locationId) {
      return NextResponse.json({ error: "locationId required for Administration role" }, { status: 400 });
    }

    // Create Firebase Auth user via REST API (no firebase-admin/auth needed)
    const uid = await createFirebaseUser(email, password, name);

    const db = getAdminDb();
    const now = new Date();

    if (isLocationRole && locationId) {
      // Write to location subcollection
      await db.collection("locations").doc(locationId).collection("locationUsers").doc(uid).set({
        uid, locationId, name, email, role,
        isActive: true, createdAt: now, updatedAt: now,
      });
      await db.collection("systemUsers").doc(uid).set({ uid, role, locationId, collegeId: "", email, name });
    } else if (isCollegeRole && collegeId) {
      // Write user profile to college subcollection
      await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
        uid, collegeId, name, email, role,
        department: department ?? "",
        isActive: true, createdAt: now, updatedAt: now,
      });
      await db.collection("systemUsers").doc(uid).set({ uid, role, collegeId, email, name });
      // Write audit log
      await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
        collegeId, action: "USER_CREATED",
        performedBy: "SUPER_ADMIN", performedByName: "Super Admin",
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
