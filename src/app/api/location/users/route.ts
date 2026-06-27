export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember, requireSuperAdmin, verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import type { UserRole } from "@/types";

const LOCATION_ROLES: UserRole[] = ["HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD", "ACCOUNTS"];
const ADMIN_CREATABLE_ROLES: UserRole[] = ["HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS", "LOCATION_DEPT_HEAD"];
// These roles can only have one holder per location
const SINGLETON_ROLES: UserRole[] = ["HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS"];

// Administration can also create Principals for colleges in their location
// but that goes through a separate endpoint

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;

    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });

    // Super Admin can query any location; Administration can only query their own
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationUsers")
      .get();
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    return NextResponse.json({ users });
  } catch (err) {
    console.error("[location/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin = session.role === "SUPER_ADMIN" || session.role === "ADMINISTRATION";
    if (!isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      locationId: string;
      department?: string;
      locationDeptId?: string;
    };

    const { name, email, password, role, locationId, department, locationDeptId } = body;

    if (!name || !email || !password || !role || !locationId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Administration can only create location-scoped non-admin roles
    if (session.role === "ADMINISTRATION") {
      if (!ADMIN_CREATABLE_ROLES.includes(role)) {
        return NextResponse.json(
          { error: `Administration can create: ${ADMIN_CREATABLE_ROLES.join(", ")}` },
          { status: 403 }
        );
      }
      if (session.locationId !== locationId) {
        return NextResponse.json({ error: "Cannot create users for another location" }, { status: 403 });
      }
    }

    const db = getAdminDb();

    // Singleton role check — only one person may hold HR_ADMIN / ADMIN_OFFICE / ACCOUNTS per location
    if (SINGLETON_ROLES.includes(role)) {
      const existing = await db
        .collection("locations")
        .doc(locationId)
        .collection("locationUsers")
        .where("role", "==", role)
        .limit(1)
        .get();
      if (!existing.empty) {
        const holder = existing.docs[0].data() as { name?: string };
        return NextResponse.json(
          { error: `${role} is already assigned to ${holder.name ?? "another user"}. Only one person can hold this role.` },
          { status: 409 }
        );
      }
    }

    // For LOCATION_DEPT_HEAD, resolve the department name from the dept document
    let resolvedDepartment = department ?? "";
    if (role === "LOCATION_DEPT_HEAD" && locationDeptId && !resolvedDepartment) {
      const deptSnap = await db
        .collection("locations").doc(locationId)
        .collection("locationDepts").doc(locationDeptId)
        .get();
      resolvedDepartment = (deptSnap.data() as { name?: string } | undefined)?.name ?? "";
    }

    const uid = await createFirebaseUser(email, password, name);
    const now = new Date();

    await db
      .collection("locations")
      .doc(locationId)
      .collection("locationUsers")
      .doc(uid)
      .set({
        uid,
        locationId,
        name,
        email,
        role,
        department: resolvedDepartment,
        locationDeptId: locationDeptId ?? "",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("systemUsers").doc(uid).set({
      uid, role, locationId, collegeId: "", email, name,
    });

    // If LOCATION_DEPT_HEAD, link them as dept head in the dept document
    if (role === "LOCATION_DEPT_HEAD" && locationDeptId) {
      await db
        .collection("locations")
        .doc(locationId)
        .collection("locationDepts")
        .doc(locationDeptId)
        .update({ deptHeadUid: uid, deptHeadName: name, updatedAt: now });
    }

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[location/users POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
