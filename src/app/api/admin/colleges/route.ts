export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { College } from "@/types";

export async function GET(request: Request) {
  try {
    // Super Admin sees all; Administration sees only their location's colleges
    const { verifySession } = await import("@/lib/auth/verifySession");
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE"].includes(session.role)) {
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
    const { name, address, contactEmail, contactPhone } = body;

    if (!name || String(name).trim().length < 2) {
      return NextResponse.json({ error: "College name is required" }, { status: 400 });
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
    await requireSuperAdmin();

    const body = (await request.json()) as {
      collegeId: string;
      isActive?: boolean;
      name?: string;
      address?: string;
      contactEmail?: string;
      contactPhone?: string;
    };
    const { collegeId, isActive, name, address, contactEmail, contactPhone } = body;

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    if (name !== undefined && String(name).trim().length < 2) {
      return NextResponse.json({ error: "College name must be at least 2 characters" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (isActive !== undefined) updates.isActive = isActive;
    if (name !== undefined) updates.name = String(name).trim();
    if (address !== undefined) updates.address = address;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;

    const db = getAdminDb();
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
