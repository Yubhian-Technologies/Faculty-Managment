export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types";

const PRINCIPAL_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE"];
const HOD_ROLES: UserRole[] = ["PANEL_MEMBER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "HOD");
    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get("role");
    const allDepts = searchParams.get("allDepts") === "true";

    const db = getAdminDb();
    const coll = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users");

    const q = roleFilter
      ? coll.where("role", "==", roleFilter)
      : coll.orderBy("name");

    const snap = await q.get();
    let users = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => (u as unknown as { role: string }).role !== "PRINCIPAL")
      .sort((a, b) => {
        const an = (a as unknown as { name?: string }).name ?? "";
        const bn = (b as unknown as { name?: string }).name ?? "";
        return an.localeCompare(bn);
      });

    // HOD sees only their department's users unless allDepts=true
    if (session.role === "HOD" && !allDepts) {
      const hodSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept) {
        users = users.filter((u) => (u as unknown as { department?: string }).department === hodDept);
      }
    }

    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "HOD");

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      department?: string;
    };

    const { name, email, password, role, department } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Enforce role-based creation rules
    if (session.role === "PRINCIPAL" && !PRINCIPAL_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Principal can only create: ${PRINCIPAL_ROLES.join(", ")}` },
        { status: 403 }
      );
    }
    if (session.role === "HOD" && !HOD_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `HOD can only create: ${HOD_ROLES.join(", ")}` },
        { status: 403 }
      );
    }

    const collegeId = session.collegeId;
    const auth = getAdminAuth();
    const db = getAdminDb();

    // For HOD: auto-assign their department if not provided
    let resolvedDepartment = department ?? "";
    if (session.role === "HOD" && !resolvedDepartment) {
      const hodSnap = await db
        .collection("colleges")
        .doc(collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      resolvedDepartment = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: true,
    });

    const uid = userRecord.uid;
    await auth.setCustomUserClaims(uid, { role, collegeId });

    const now = new Date();
    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId,
        name,
        email,
        role,
        department: resolvedDepartment,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Audit log
    let creatorName = "Unknown";
    try {
      const creatorSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      creatorName = (creatorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
        collegeId,
        action: "USER_CREATED",
        performedBy: session.uid,
        performedByName: creatorName,
        targetId: uid,
        details: { email, role, name, department: resolvedDepartment },
        timestamp: now,
      });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "auth/email-already-exists"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    console.error("[college/users POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
