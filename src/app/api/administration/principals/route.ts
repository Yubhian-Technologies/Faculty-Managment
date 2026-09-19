export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

async function fetchCollegePrincipals(db: FirebaseFirestore.Firestore, collegeId: string) {
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("users")
    .where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"])
    .get();

  // Deduplicate: a college has exactly one Principal slot. A deactivated
  // holder must NOT count as "existing" - otherwise the Add Principal/VP
  // button stays hidden forever after someone is deactivated, with no way
  // to appoint a replacement from this page.
  let principalSeen = false;
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((u) => (u as unknown as { isActive?: boolean }).isActive !== false)
    .filter((u) => {
      if ((u as unknown as { role: string }).role === "PRINCIPAL") {
        if (principalSeen) return false;
        principalSeen = true;
      }
      return true;
    });
}

export async function GET(request: Request) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");

    const db = getAdminDb();

    // No collegeId - bulk mode: every college in this location, in one
    // response, so the Colleges list page can know up front (before any row
    // is expanded) whether each one already has its Principal/VP filled,
    // instead of defaulting to "show the Add button" until a lazy per-row
    // fetch resolves.
    if (!collegeId) {
      const collegesSnap = await db.collection("colleges").where("locationId", "==", session.locationId).get();
      const entries = await Promise.all(
        collegesSnap.docs.map(async (c) => [c.id, await fetchCollegePrincipals(db, c.id)] as const)
      );
      return NextResponse.json({ principalsByCollege: Object.fromEntries(entries) });
    }

    // Verify college belongs to this location
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) {
      return NextResponse.json({ error: "College not found" }, { status: 404 });
    }
    const collegeData = collegeSnap.data() as { locationId?: string };
    if (collegeData.locationId !== session.locationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const principals = await fetchCollegePrincipals(db, collegeId);
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

    // Enforce one Principal per college - a deactivated holder doesn't count,
    // same as the GET listing above, so a replacement can be appointed.
    if (role === "PRINCIPAL") {
      const existingSnap = await db
        .collection("colleges").doc(collegeId).collection("users")
        .where("role", "==", "PRINCIPAL").get();
      if (existingSnap.docs.some((d) => (d.data() as { isActive?: boolean }).isActive !== false)) {
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
