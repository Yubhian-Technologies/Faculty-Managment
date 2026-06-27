export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

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
      .where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"])
      .get();

    const principals = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    return NextResponse.json({ principals });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[administration/principals GET]", err);
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

    if (!["PRINCIPAL", "VICE_PRINCIPAL"].includes(role)) {
      return NextResponse.json({ error: "Only PRINCIPAL or VICE_PRINCIPAL allowed" }, { status: 400 });
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

    // Enforce one Principal per college
    if (role === "PRINCIPAL") {
      const existingSnap = await db
        .collection("colleges").doc(collegeId).collection("users")
        .where("role", "==", "PRINCIPAL").limit(1).get();
      if (!existingSnap.empty) {
        return NextResponse.json({ error: "A Principal account already exists for this college" }, { status: 409 });
      }
    }

    const uid = await createFirebaseUser(email, password, name);

    const db2 = getAdminDb();
    const now = new Date();

    await db2.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
      uid, collegeId, name, email, role,
      department: "",
      isActive: true, createdAt: now, updatedAt: now,
    });

    await db2.collection("systemUsers").doc(uid).set({
      uid, role, collegeId, email, name,
    });

    await db2.collection("colleges").doc(collegeId).collection("auditLogs").add({
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
    console.error("[administration/principals POST]", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
