export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .orderBy("name")
      .get();
    const depts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ departments: depts });
  } catch (err) {
    console.error("[location/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      name: string;
      locationId: string;
    };
    const { name, locationId } = body;
    if (!name || !locationId) {
      return NextResponse.json({ error: "name and locationId required" }, { status: 400 });
    }
    if (session.role === "ADMINISTRATION" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const now = new Date();
    const ref = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .add({ name: name.trim(), locationId, isActive: true, createdAt: now, updatedAt: now });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error("[location/departments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
