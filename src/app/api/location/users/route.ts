export const dynamic = "force-dynamic";

import { firebaseAuthErrorResponse } from "@/lib/http/firebaseErrors";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import type { UserRole } from "@/types";

const ADMIN_CREATABLE_ROLES: UserRole[] = ["LOCATION_STAFF_ADMIN", "HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS", "LOCATION_DEPT_HEAD"];
const SINGLETON_ROLES: UserRole[] = ["LOCATION_STAFF_ADMIN", "HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS"];

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;

    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });

    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationUsers")
      .get();
    const users = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => !(session.role === "ADMINISTRATION" && (u as { uid?: string }).uid === session.uid));
    return NextResponse.json({ users });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    const authErr = firebaseAuthErrorResponse(err);
    if (authErr) return authErr;
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

    const body = (await readJsonBody(request)) as {
      name: string;
      mobile: string;
      email?: string;
      password: string;
      role: UserRole;
      locationId: string;
      department?: string;
      locationDeptId?: string;
      locationDeptIds?: string[];
      allLocationDepts?: boolean;
      profilePhotoUrl?: string;
    };

    const {
      name, mobile, password, role, locationId, department, locationDeptId,
      locationDeptIds, allLocationDepts, profilePhotoUrl,
    } = body;

    if (!name || !mobile || !password || !role || !locationId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!/^[6-9]\d{9}$/.test(mobile.trim())) {
      return NextResponse.json({ error: "Valid 10-digit mobile number required" }, { status: 400 });
    }
    // The login is the EMAIL (Firebase Auth needs one, and the sign-in page signs staff in by email); the mobile is
    // contact detail. A request without an email (older form) is refused clearly instead of failing at Firebase.
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email - it is the sign-in for this account" }, { status: 400 });
    }
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
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

    // Singleton role check
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
        mobile: mobile.trim(),
        role,
        department: resolvedDepartment,
        locationDeptId: locationDeptId ?? "",
        ...(role !== "LOCATION_DEPT_HEAD"
          ? { allLocationDepts: !!allLocationDepts, locationDeptIds: allLocationDepts ? [] : (locationDeptIds ?? []) }
          : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("systemUsers").doc(uid).set({
      uid, role, locationId, collegeId: "", email, name, mobile: mobile.trim(),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
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
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const authErr = firebaseAuthErrorResponse(err);
    if (authErr) return authErr;
    // Firebase refused to create the sign-in (e.g. INVALID_EMAIL, OPERATION_NOT_ALLOWED): say so instead of a bare 500.
    if (err && typeof err === "object" && (err as { code?: string }).code === "auth/create-failed") {
      console.error("[location/users POST] Firebase sign-up refused:", (err as Error).message);
      return NextResponse.json({ error: `Couldn't create the sign-in (${(err as Error).message})` }, { status: 400 });
    }
    console.error("[location/users POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
