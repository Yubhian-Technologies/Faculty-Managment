export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { College, CollegeType } from "@/types";

function isValidLatLng(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && longitude >= -180 && longitude <= 180;
}

function isValidCampusLocation(campusLocation: College["campusLocation"]): boolean {
  if (!campusLocation) return true;
  if (campusLocation.shape === "circle") {
    return isValidLatLng(campusLocation.latitude, campusLocation.longitude)
      && typeof campusLocation.radiusMeters === "number" && campusLocation.radiusMeters > 0;
  }
  if (campusLocation.shape === "polygon") {
    return Array.isArray(campusLocation.points)
      && campusLocation.points.length >= 3
      && campusLocation.points.every((p) => isValidLatLng(p.latitude, p.longitude));
  }
  return false;
}

const COLLEGE_TYPES: CollegeType[] = ["ENGINEERING", "SCHOOL", "DENTAL", "PHARMACY", "POLYTECHNIC", "DEGREE"];

export async function GET(request: Request) {
  try {
    // Super Admin sees all; Administration sees only their location's colleges;
    // FINANCE/PURCHASE_DEPT (GLOBAL roles, no college of their own) also see all -
    // this is how their CollegeSwitcher populates its options.
    const { verifySession } = await import("@/lib/auth/verifySession");
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "FINANCE", "PURCHASE_DEPT"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filterLocationId = searchParams.get("locationId") ?? (session.role !== "SUPER_ADMIN" ? session.locationId : "");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges");
    if (filterLocationId) {
      query = query.where("locationId", "==", filterLocationId);
    }
    const snap = await query.get();
    const colleges = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ colleges });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/colleges GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { verifySession } = await import("@/lib/auth/verifySession");
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Partial<College> & { locationId?: string };
    const { name, type, address, contactEmail, contactPhone } = body;

    if (!name || String(name).trim().length < 2) {
      return NextResponse.json({ error: "College name is required" }, { status: 400 });
    }
    if (!type || !COLLEGE_TYPES.includes(type)) {
      return NextResponse.json({ error: "College type is required" }, { status: 400 });
    }

    // Administration uses their own locationId; Super Admin must supply one
    const locationId =
      session.role === "ADMINISTRATION"
        ? (session.locationId ?? "")
        : (body.locationId ?? "");

    if (!locationId) {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const now = new Date();

    await db.collection("colleges").doc(collegeId).set({
      name: String(name).trim(),
      locationId,
      type,
      address: address ?? "",
      contactEmail: contactEmail ?? "",
      contactPhone: contactPhone ?? "",
      isActive: true,
      logoUrl: "",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ collegeId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/colleges POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSuperAdmin();

    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();

    const usersSnap = await db.collection("colleges").doc(collegeId).collection("users").limit(1).get();
    if (!usersSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a college that still has users. Remove or reassign its users first." },
        { status: 400 }
      );
    }

    await db.collection("colleges").doc(collegeId).delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/colleges DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { verifySession } = await import("@/lib/auth/verifySession");
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      collegeId: string;
      isActive?: boolean;
      name?: string;
      type?: CollegeType;
      address?: string;
      contactEmail?: string;
      contactPhone?: string;
      campusLocation?: College["campusLocation"] | null;
    };
    const { collegeId, isActive, name, type, address, contactEmail, contactPhone, campusLocation } = body;

    // The campus geofence gates a security-relevant check (self-attendance
    // location verification) - Super Admin only, never Administration, even
    // though Administration can edit everything else about their own colleges.
    if (campusLocation !== undefined && session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only Super Admin can set the campus location" }, { status: 401 });
    }

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    if (name !== undefined && String(name).trim().length < 2) {
      return NextResponse.json({ error: "College name must be at least 2 characters" }, { status: 400 });
    }
    if (type !== undefined && !COLLEGE_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid college type" }, { status: 400 });
    }

    const db = getAdminDb();

    // Administration may only edit colleges within their own location, and cannot
    // (de)activate them - that stays a Super Admin-only power.
    if (session.role === "ADMINISTRATION") {
      if (isActive !== undefined) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const collegeSnap = await db.collection("colleges").doc(collegeId).get();
      if (!collegeSnap.exists || collegeSnap.data()?.locationId !== session.locationId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (campusLocation && !isValidCampusLocation(campusLocation)) {
      return NextResponse.json({ error: "Invalid campus location" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (isActive !== undefined) updates.isActive = isActive;
    if (name !== undefined) updates.name = String(name).trim();
    if (type !== undefined) updates.type = type;
    if (address !== undefined) updates.address = address;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (campusLocation !== undefined) updates.campusLocation = campusLocation;

    await db.collection("colleges").doc(collegeId).update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/colleges PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
