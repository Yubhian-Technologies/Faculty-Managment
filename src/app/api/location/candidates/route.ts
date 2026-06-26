export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .orderBy("createdAt", "desc")
      .get();

    const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[location/candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    const canAdd = session && (session.role === "HR_ADMIN" || session.role === "LOCATION_DEPT_HEAD");
    if (!canAdd) {
      return NextResponse.json({ error: "Only HR Admin or Dept Head can add candidates" }, { status: 403 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      name: string;
      email: string;
      phone: string;
      department: string;
      qualification?: string;
      vacancyId?: string;
      notes?: string;
    };

    const { name, email, phone, department, qualification, vacancyId, notes } = body;
    if (!name || !email || !phone || !department) {
      return NextResponse.json({ error: "name, email, phone and department are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const ref = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .add({
        locationId: session.locationId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        department: department.trim(),
        appliedPosition: "Faculty",
        qualification: qualification?.trim() ?? "",
        vacancyId: vacancyId ?? "",
        notes: notes?.trim() ?? "",
        addedByUid: session.uid,
        addedByRole: session.role,
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error("[location/candidates POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
