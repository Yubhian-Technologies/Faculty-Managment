export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import type { UserRole } from "@/types";

const PRINCIPAL_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_STAFF"];
const HOD_ROLES: UserRole[] = ["PANEL_MEMBER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD");
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
      : coll;

    const includeAll = searchParams.get("includeAll") === "true";

    const snap = await q.get();
    let users = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => includeAll || (u as unknown as { role: string }).role !== "PRINCIPAL")
      .sort((a, b) => {
        const an = (a as unknown as { name?: string }).name ?? "";
        const bn = (b as unknown as { name?: string }).name ?? "";
        return an.localeCompare(bn);
      });

    // A college has exactly one Principal — deduplicate to avoid showing test duplicates
    if (includeAll) {
      let principalSeen = false;
      users = users.filter((u) => {
        if ((u as unknown as { role: string }).role === "PRINCIPAL") {
          if (principalSeen) return false;
          principalSeen = true;
        }
        return true;
      });
    }

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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD");

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      department?: string;
      staffType?: "teaching" | "supporting";
      designation?: string; // free-text title for COLLEGE_STAFF (e.g. "Dean - R&D")
      academicProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const { name, email, password, role, department, academicProfile, profilePhotoUrl, designation } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Uploaded before the account exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific uid.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    // Enforce role-based creation rules — Vice Principal mirrors Principal's authority.
    if ((session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") && !PRINCIPAL_ROLES.includes(role)) {
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

    // Create Firebase Auth user via REST API (no firebase-admin/auth required)
    const uid = await createFirebaseUser(email, password, name);

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
        ...(body.staffType ? { staffType: body.staffType } : {}),
        ...(designation ? { designation } : {}),
        ...(academicProfile ? { academicProfile } : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        ...buildPersonalDetailsUpdate(body),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Role mapping for Firestore-based session resolution
    await db.collection("systemUsers").doc(uid).set({
      uid, role, collegeId, email, name,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
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
