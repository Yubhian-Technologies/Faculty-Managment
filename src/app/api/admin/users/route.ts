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

const SUPER_ADMIN_ROLES: UserRole[] = ["PRINCIPAL", "ACCOUNTS"];

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      collegeId: string;
      department?: string;
    };

    const { name, email, password, role, collegeId, department } = body;

    if (!name || !email || !password || !role || !collegeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!SUPER_ADMIN_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Super Admin can only create: ${SUPER_ADMIN_ROLES.join(", ")}` },
        { status: 403 }
      );
    }

    // Create Firebase Auth user via REST API (no firebase-admin/auth needed)
    const uid = await createFirebaseUser(email, password, name);

    const db = getAdminDb();
    const now = new Date();

    // Write user profile to college subcollection
    await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
      uid,
      collegeId,
      name,
      email,
      role,
      department: department ?? "",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Write role mapping so session creation can resolve role without custom claims
    await db.collection("systemUsers").doc(uid).set({ uid, role, collegeId, email, name });

    // Write audit log
    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "USER_CREATED",
      performedBy: "SUPER_ADMIN",
      performedByName: "Super Admin",
      targetId: uid,
      details: { email, role, name },
      timestamp: now,
    });

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
