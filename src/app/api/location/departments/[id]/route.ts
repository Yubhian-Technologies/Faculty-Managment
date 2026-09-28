export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (
      !session ||
      !["SUPER_ADMIN", "ADMINISTRATION", "LOCATION_STAFF_ADMIN", "LOCATION_DEPT_HEAD"].includes(
        session.role
      )
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(id);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const deptData = { id: deptSnap.id, ...deptSnap.data() };

    // Check dept head user details & multi-dept management
    let headUser: Record<string, unknown> | null = null;
    let otherManagedDepts: Array<{ id: string; name: string }> = [];

    const headUid = (deptData as { headUid?: string; deptHeadUid?: string }).headUid || (deptData as { headUid?: string; deptHeadUid?: string }).deptHeadUid;
    if (headUid) {
      const uDoc = await db.collection("locations").doc(locationId).collection("locationUsers").doc(headUid).get();
      if (uDoc.exists) {
        headUser = { id: uDoc.id, ...uDoc.data() };
      }
      // Check other depts headed by this person
      const [h1, h2] = await Promise.all([
        db.collection("locations").doc(locationId).collection("locationDepts").where("headUid", "==", headUid).get(),
        db.collection("locations").doc(locationId).collection("locationDepts").where("deptHeadUid", "==", headUid).get(),
      ]);
      const otherMap = new Map<string, string>();
      for (const doc of [...h1.docs, ...h2.docs]) {
        if (doc.id !== id) {
          otherMap.set(doc.id, (doc.data().name as string) || doc.id);
        }
      }
      otherManagedDepts = Array.from(otherMap.entries()).map(([dId, name]) => ({ id: dId, name }));
    }

    // Stats
    const [staffSnap, allShiftsSnap] = await Promise.all([
      db.collection("locations").doc(locationId).collection("staff").where("departmentId", "==", id).get(),
      db.collection("locations").doc(locationId).collection("shifts").get(),
    ]);

    const staffCount = staffSnap.size;
    const shiftCount = allShiftsSnap.docs.filter((d) => {
      const data = d.data();
      if (data.isCampusWide || data.departmentId === "ALL") return true;
      if (data.departmentId === id) return true;
      if (Array.isArray(data.departmentIds) && (data.departmentIds.includes("ALL") || data.departmentIds.includes(id))) {
        return true;
      }
      return false;
    }).length;

    return NextResponse.json({
      department: {
        ...deptData,
        staffCount,
      },
      headUser,
      otherManagedDepts,
      stats: {
        staffCount,
        shiftCount,
      },
    });
  } catch (err) {
    console.error("[location/departments/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Rename and/or activate/deactivate a location department. Same
// authorization shape as this collection's own POST: SUPER_ADMIN can act on
// any location, ADMINISTRATION (Location Admin) only on its own.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION", "LOCATION_STAFF_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as {
      locationId?: string;
      name?: string;
      code?: string;
      description?: string;
      headUid?: string | null;
      headStaffId?: string | null;
      headName?: string | null;
      headEmail?: string | null;
      headPhone?: string | null;
      isActive?: boolean;
      loginCredentials?: { email: string; password: string };
    };
    const locationId = body.locationId || session.locationId;

    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(id);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.code !== undefined) updates.code = body.code.trim().toUpperCase();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.headUid !== undefined) updates.headUid = body.headUid;
    if (body.headStaffId !== undefined) updates.headStaffId = body.headStaffId;
    if (body.headName !== undefined) updates.headName = body.headName;
    if (body.headEmail !== undefined) updates.headEmail = body.headEmail;
    if (body.headPhone !== undefined) updates.headPhone = body.headPhone;

    let credentialsCreated = false;
    let createdLoginEmail: string | undefined;

    // Check if new login credentials should be created for this Department Head
    if (body.loginCredentials?.email && body.loginCredentials?.password) {
      const credEmail = body.loginCredentials.email.trim().toLowerCase();
      const credPassword = body.loginCredentials.password.trim();
      const displayName =
        body.headName?.trim() ||
        body.name?.trim() ||
        (deptSnap.data() as { name?: string })?.name ||
        "Department Head";

      const newUid = await createFirebaseUser(credEmail, credPassword, displayName);
      updates.headUid = newUid;
      updates.headEmail = credEmail;
      credentialsCreated = true;
      createdLoginEmail = credEmail;

      const deptName = body.name?.trim() || (deptSnap.data() as { name?: string })?.name || "";

      // Create location user record
      await db.collection("locations").doc(locationId).collection("locationUsers").doc(newUid).set({
        uid: newUid,
        locationId,
        name: displayName,
        email: credEmail,
        phone: body.headPhone?.trim() || "",
        role: "LOCATION_DEPT_HEAD",
        department: deptName,
        locationDeptId: id,
        locationDeptIds: [id],
        staffId: body.headStaffId || null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // Create system user record for auth mapping
      await db.collection("systemUsers").doc(newUid).set({
        uid: newUid,
        role: "LOCATION_DEPT_HEAD",
        locationId,
        collegeId: "",
        email: credEmail,
        name: displayName,
      });
    }

    await deptRef.set(updates, { merge: true });

    // If headStaffId was provided, update that staff member's department and link credentials
    if (body.headStaffId) {
      const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(body.headStaffId);
      const staffUpdates: Record<string, unknown> = {
        departmentId: id,
        departmentName: body.name || (deptSnap.data() as { name?: string })?.name || "",
        isDeptHead: true,
        updatedAt: now,
      };
      if (updates.headUid) staffUpdates.userUid = updates.headUid;
      if (updates.headEmail) staffUpdates.userEmail = updates.headEmail;

      await staffRef.set(staffUpdates, { merge: true });
    }

    // If headUid was updated, ensure locationUsers document reflects this department
    const resolvedHeadUid = (updates.headUid as string | null) || body.headUid;
    if (resolvedHeadUid) {
      const userRef = db.collection("locations").doc(locationId).collection("locationUsers").doc(resolvedHeadUid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const udata = userDoc.data() as { locationDeptIds?: string[] };
        const existingIds = udata.locationDeptIds ?? [];
        if (!existingIds.includes(id)) {
          await userRef.set(
            {
              role: "LOCATION_DEPT_HEAD",
              locationDeptId: id,
              locationDeptIds: [...existingIds, id],
              updatedAt: now,
            },
            { merge: true }
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      credentialsCreated,
      loginEmail: createdLoginEmail,
    });
  } catch (err: unknown) {
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json(
        { error: "An account with this login email already exists. Use a different email or select existing user." },
        { status: 409 }
      );
    }
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/weak-password"
    ) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    console.error("[location/departments/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Permanently removes a location department. Refuses while a Dept Head is
// still assigned to it (deptHeadUid set by /api/location/users' own POST/
// PATCH when someone is appointed LOCATION_DEPT_HEAD here) - deleting out
// from under them would leave that person's account pointing at a
// locationDeptId that no longer resolves to anything.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION", "LOCATION_STAFF_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId || "";
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(id);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // Clean up references in locationUsers and staff if a head was assigned
    const deptData = deptSnap.data() as { headUid?: string; deptHeadUid?: string; headStaffId?: string };
    const headUid = deptData.headUid || deptData.deptHeadUid;
    const headStaffId = deptData.headStaffId || headUid;

    if (headStaffId) {
      const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(headStaffId);
      const staffDoc = await staffRef.get();
      if (staffDoc.exists) {
        await staffRef.set(
          {
            isDeptHead: false,
            departmentId: "",
            departmentName: "Unassigned",
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
    }

    if (headUid) {
      const userRef = db.collection("locations").doc(locationId).collection("locationUsers").doc(headUid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const udata = userDoc.data() as { locationDeptIds?: string[] };
        const remaining = (udata.locationDeptIds ?? []).filter((deptId) => deptId !== id);
        await userRef.set(
          {
            locationDeptId: remaining[0] || null,
            locationDeptIds: remaining,
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
    }

    await deptRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[location/departments/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
