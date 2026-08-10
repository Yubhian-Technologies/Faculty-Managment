export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

// Placement Department / Library / Exam Cell - college-scoped, one holder
// per role per college (see ROLE_SCOPE in src/types/core.ts). Mirrors
// administration/principals/route.ts, kept as its own route so the working
// Principal/Vice Principal flow is untouched.
const COLLEGE_STAFF_ROLES = ["PLACEMENT_DEPT", "EXAM_CELL"];

export async function GET(request: Request) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Verify college belongs to this location
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const collegeData = collegeSnap.data() as { locationId?: string };
    if (collegeData.locationId !== session.locationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .where("role", "in", COLLEGE_STAFF_ROLES)
      .get();

    const staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    return NextResponse.json({ staff });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[administration/college-staff GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");

    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
      role: string;
      collegeId: string;
    };

    const { name, email, password, role, collegeId } = body;

    if (!name || !email || !password || !collegeId || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!COLLEGE_STAFF_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Only ${COLLEGE_STAFF_ROLES.join(", ")} allowed` },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Verify college belongs to this location
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const collegeData = collegeSnap.data() as { locationId?: string };
    if (collegeData.locationId !== session.locationId) {
      return NextResponse.json({ error: "College does not belong to your location" }, { status: 403 });
    }

    // Enforce one holder per role per college
    const existingSnap = await db
      .collection("colleges").doc(collegeId).collection("users")
      .where("role", "==", role).limit(1).get();
    if (!existingSnap.empty) {
      const holder = existingSnap.docs[0].data() as { name?: string };
      return NextResponse.json(
        { error: `${role} is already assigned to ${holder.name ?? "another user"} for this college. Only one person can hold this role.` },
        { status: 409 }
      );
    }

    const uid = await createFirebaseUser(email, password, name);
    const now = new Date();

    await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
      uid, collegeId, name, email, role,
      department: "",
      isActive: true, createdAt: now, updatedAt: now,
    });

    await db.collection("systemUsers").doc(uid).set({
      uid, role, collegeId, email, name,
    });

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId, action: "USER_CREATED",
      performedBy: session.uid, performedByName: "Administration",
      targetId: uid, details: { email, role, name }, timestamp: now,
    });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[administration/college-staff POST]", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
