export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import { narrowToActiveLocationDept } from "@/lib/location/activeLocationDept";
import type { LocationStaffMember } from "@/types/locationStaff";

export async function GET(request: Request) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Determine allowed departments for Dept Heads
    let allowedDeptIds: string[] | null = null;
    if (session.role === "LOCATION_DEPT_HEAD") {
      const userDoc = await db
        .collection("locations")
        .doc(locationId)
        .collection("locationUsers")
        .doc(session.uid)
        .get();
      const udata = (userDoc.data() as { locationDeptId?: string; locationDeptIds?: string[] } | undefined) ?? {};
      const depts = Array.from(
        new Set([...(udata.locationDeptIds ?? []), ...(udata.locationDeptId ? [udata.locationDeptId] : [])])
      );

      // Also check departments where headUid === session.uid
      const deptsQuery = await db
        .collection("locations")
        .doc(locationId)
        .collection("locationDepts")
        .where("headUid", "==", session.uid)
        .get();
      for (const d of deptsQuery.docs) {
        if (!depts.includes(d.id)) depts.push(d.id);
      }

      allowedDeptIds = depts;
    }

    const requestedDeptId = searchParams.get("departmentId");
    const requestedShiftId = searchParams.get("shiftId");
    const requestedRole = searchParams.get("role");
    const requestedStatus = searchParams.get("status") || "ACTIVE";
    const searchQuery = searchParams.get("search")?.toLowerCase().trim() || "";

    // If Dept Head, check active department or scope to allowed
    let targetDeptId = requestedDeptId;
    if (session.role === "LOCATION_DEPT_HEAD") {
      if (!targetDeptId && allowedDeptIds && allowedDeptIds.length > 0) {
        targetDeptId = await narrowToActiveLocationDept(session.uid, allowedDeptIds);
      }
      if (targetDeptId && allowedDeptIds && !allowedDeptIds.includes(targetDeptId)) {
        return NextResponse.json({ error: "Unauthorized for this department" }, { status: 403 });
      }
    }

    let query: FirebaseFirestore.Query = db
      .collection("locations")
      .doc(locationId)
      .collection("staff");

    if (requestedStatus !== "ALL") {
      query = query.where("status", "==", requestedStatus);
    }
    if (targetDeptId) {
      query = query.where("departmentId", "==", targetDeptId);
    }
    if (requestedShiftId) {
      query = query.where("shiftId", "==", requestedShiftId);
    }
    if (requestedRole && requestedRole !== "ALL") {
      query = query.where("role", "==", requestedRole);
    }

    const snap = await query.get();
    let staffList = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LocationStaffMember);

    // Apply allowedDeptIds filter if Dept Head without specific targetDeptId
    if (session.role === "LOCATION_DEPT_HEAD" && !targetDeptId && allowedDeptIds) {
      staffList = staffList.filter((s) => allowedDeptIds!.includes(s.departmentId));
    }

    // Client-side text search if provided
    if (searchQuery) {
      staffList = staffList.filter(
        (s) =>
          s.name?.toLowerCase().includes(searchQuery) ||
          s.contactNumber?.includes(searchQuery) ||
          s.aadhaar?.includes(searchQuery) ||
          s.payeeVoucher?.toLowerCase().includes(searchQuery) ||
          s.role?.toLowerCase().includes(searchQuery) ||
          s.fatherName?.toLowerCase().includes(searchQuery)
      );
    }

    // Sort alphabetically by name
    staffList.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ staff: staffList });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const body = (await request.json()) as Partial<LocationStaffMember> & { locationId?: string };
    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    // Fields per schema: Name, Contact, Aadhaar, Role, Payee are mandatory. Father name & address are optional.
    const name = body.name?.trim();
    const fatherName = body.fatherName?.trim() || "";
    const contactNumber = body.contactNumber?.trim();
    const aadhaar = body.aadhaar?.trim();
    const address = body.address?.trim() || "";
    const payeeVoucher = body.payeeVoucher?.trim();
    const role = body.role?.trim();
    const departmentId = body.departmentId?.trim() || "";

    if (!name || !contactNumber || !aadhaar || !payeeVoucher || !role) {
      return NextResponse.json(
        { error: "Missing required fields: Name, Contact Number, Aadhaar, Payee Type, Role" },
        { status: 400 }
      );
    }

    if (!/^\d{10}$/.test(contactNumber)) {
      return NextResponse.json({ error: "Contact number must be exactly 10 digits" }, { status: 400 });
    }

    if (!/^\d{12}$/.test(aadhaar)) {
      return NextResponse.json({ error: "Aadhaar must be exactly 12 numeric digits" }, { status: 400 });
    }

    if (body.spouseGuardianPhone?.trim() && !/^\d{10}$/.test(body.spouseGuardianPhone.trim())) {
      return NextResponse.json({ error: "Spouse/guardian phone must be exactly 10 digits" }, { status: 400 });
    }

    if (body.spouseGuardianAadhaar?.trim() && !/^\d{12}$/.test(body.spouseGuardianAadhaar.trim())) {
      return NextResponse.json({ error: "Spouse/guardian Aadhaar must be exactly 12 numeric digits" }, { status: 400 });
    }

    if (session.role === "LOCATION_DEPT_HEAD" && !departmentId) {
      return NextResponse.json(
        { error: "Department is required for Department Head to add staff" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    let departmentName = "Unassigned";

    if (departmentId) {
      // Verify department exists
      const deptSnap = await db
        .collection("locations")
        .doc(locationId)
        .collection("locationDepts")
        .doc(departmentId)
        .get();
      if (!deptSnap.exists) {
        return NextResponse.json({ error: "Invalid department" }, { status: 400 });
      }
      const deptData = deptSnap.data() as { name?: string; headUid?: string };
      departmentName = deptData.name || "";

      // Dept Head permission check
      if (session.role === "LOCATION_DEPT_HEAD" && deptData.headUid !== session.uid) {
        // Check if session has multiple departments
        const userDoc = await db.collection("locations").doc(locationId).collection("locationUsers").doc(session.uid).get();
        const udata = (userDoc.data() as { locationDeptIds?: string[] } | undefined) ?? {};
        if (!udata.locationDeptIds?.includes(departmentId)) {
          return NextResponse.json({ error: "Unauthorized for this department" }, { status: 403 });
        }
      }
    }

    // Resolve shift name if shiftId is provided
    let shiftName = body.shiftName || "";
    if (body.shiftId && !shiftName) {
      const shiftSnap = await db
        .collection("locations")
        .doc(locationId)
        .collection("shifts")
        .doc(body.shiftId)
        .get();
      if (shiftSnap.exists) {
        shiftName = (shiftSnap.data() as { name?: string })?.name || "";
      }
    }

    const now = Timestamp.now();
    const staffPayload: Omit<LocationStaffMember, "id"> = {
      locationId,
      departmentId,
      departmentName,
      photoUrl: body.photoUrl || "",
      name,
      fatherName,
      contactNumber,
      aadhaar,
      spouseGuardianName: body.spouseGuardianName?.trim() || "",
      spouseGuardianPhone: body.spouseGuardianPhone?.trim() || "",
      spouseGuardianAadhaar: body.spouseGuardianAadhaar?.trim() || "",
      address,
      payeeVoucher,
      role,
      shiftId: body.shiftId || "",
      shiftName,
      status: body.status || "ACTIVE",
      dateOfJoining: body.dateOfJoining || new Date().toISOString().split("T")[0],
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db
      .collection("locations")
      .doc(locationId)
      .collection("staff")
      .add(staffPayload);

    // Increment department staff count if assigned
    if (departmentId) {
      await db
        .collection("locations")
        .doc(locationId)
        .collection("locationDepts")
        .doc(departmentId)
        .set({ updatedAt: now }, { merge: true });
    }

    return NextResponse.json({ id: ref.id, ...staffPayload }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
