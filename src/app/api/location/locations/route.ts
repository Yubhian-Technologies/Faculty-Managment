export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import type { LocationConfig } from "@/types/locationStaff";

export async function GET(request: Request) {
  try {
    const session = await requireRole("LOCATION_STAFF_ADMIN", "ADMINISTRATION", "SUPER_ADMIN");

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }

    const db = getAdminDb();
    const snap = await db.collection("locations").doc(locationId).collection("reportLocations").get();
    const locations = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LocationConfig[];
    return NextResponse.json({ locations });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/locations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole("LOCATION_STAFF_ADMIN", "ADMINISTRATION", "SUPER_ADMIN");

    const body = (await readJsonBody(request)) as {
      name: string;
      address: string;
      city: string;
      state: string;
      locationId?: string;
    };
    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (!body.name || !body.city) {
      return NextResponse.json({ error: "name and city required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Cannot create locations for another location" }, { status: 403 });
    }

    const db = getAdminDb();
    const now = Timestamp.now();
    const ref = await db.collection("locations").doc(locationId).collection("reportLocations").add({
      name: body.name.trim(),
      address: body.address?.trim() || "",
      city: body.city.trim(),
      state: body.state?.trim() || "",
      locationId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id, ...body }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/locations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
