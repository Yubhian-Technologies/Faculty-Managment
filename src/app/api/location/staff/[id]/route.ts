export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { LocationStaffMember } from "@/types/locationStaff";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection("locations").doc(locationId).collection("staff").doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    const staff = { id: docSnap.id, ...docSnap.data() } as LocationStaffMember;
    return NextResponse.json({ staff });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const body = (await request.json()) as Partial<LocationStaffMember> & { locationId?: string };
    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection("locations").doc(locationId).collection("staff").doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    const current = docSnap.data() as LocationStaffMember;

    // Check dept head permissions
    if (session.role === "LOCATION_DEPT_HEAD") {
      const userDoc = await db.collection("locations").doc(locationId).collection("locationUsers").doc(session.uid).get();
      const udata = (userDoc.data() as { locationDeptId?: string; locationDeptIds?: string[] } | undefined) ?? {};
      const depts = Array.from(
        new Set([...(udata.locationDeptIds ?? []), ...(udata.locationDeptId ? [udata.locationDeptId] : [])])
      );
      if (!depts.includes(current.departmentId)) {
        return NextResponse.json({ error: "Unauthorized for this department" }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.fatherName !== undefined) updates.fatherName = body.fatherName.trim();
    if (body.contactNumber !== undefined) updates.contactNumber = body.contactNumber.trim();
    if (body.aadhaar !== undefined) updates.aadhaar = body.aadhaar.trim();
    if (body.spouseGuardianName !== undefined) updates.spouseGuardianName = body.spouseGuardianName.trim();
    if (body.spouseGuardianPhone !== undefined) updates.spouseGuardianPhone = body.spouseGuardianPhone.trim();
    if (body.spouseGuardianAadhaar !== undefined) updates.spouseGuardianAadhaar = body.spouseGuardianAadhaar.trim();
    if (body.address !== undefined) updates.address = body.address.trim();
    if (body.payeeVoucher !== undefined) updates.payeeVoucher = body.payeeVoucher.trim();
    if (body.role !== undefined) updates.role = body.role.trim();
    if (body.photoUrl !== undefined) updates.photoUrl = body.photoUrl;
    if (body.status !== undefined) updates.status = body.status;
    if (body.shiftId !== undefined) {
      updates.shiftId = body.shiftId;
      if (body.shiftId) {
        const shiftSnap = await db.collection("locations").doc(locationId).collection("shifts").doc(body.shiftId).get();
        if (shiftSnap.exists) {
          updates.shiftName = (shiftSnap.data() as { name?: string })?.name || "";
        }
      } else {
        updates.shiftName = "";
      }
    }

    await docRef.set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection("locations").doc(locationId).collection("staff").doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    // Soft delete: mark INACTIVE
    await docRef.set({ status: "INACTIVE", updatedAt: new Date() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
