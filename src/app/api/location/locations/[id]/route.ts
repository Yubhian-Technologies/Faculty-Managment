export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import type { LocationConfig } from "@/types/locationStaff";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("LOCATION_STAFF_ADMIN", "ADMINISTRATION", "SUPER_ADMIN");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }
    const db = getAdminDb();
    const docSnap = await db.collection("locations").doc(locationId).collection("reportLocations").doc(id).get();
    if (!docSnap.exists) return NextResponse.json({ error: "Location not found" }, { status: 404 });
    return NextResponse.json({ location: { id: docSnap.id, ...docSnap.data() } as LocationConfig });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[location/locations/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("LOCATION_STAFF_ADMIN", "ADMINISTRATION", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { name?: string; address?: string; city?: string; state?: string; isActive?: boolean };
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }
    const db = getAdminDb();
    const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.address !== undefined) updates.address = body.address.trim();
    if (body.city !== undefined) updates.city = body.city.trim();
    if (body.state !== undefined) updates.state = body.state.trim();
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    const docRef = db.collection("locations").doc(locationId).collection("reportLocations").doc(id);
    await docRef.set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[location/locations/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });
    if (session.locationId !== locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    const db = getAdminDb();
    const docRef = db.collection("locations").doc(locationId).collection("reportLocations").doc(id);
    await docRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && err.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[location/locations/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
