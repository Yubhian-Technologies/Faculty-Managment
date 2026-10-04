export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }

    const db = getAdminDb();
    const deptsSnap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .orderBy("name")
      .get();

    // Always count live via aggregation queries (cheap - billed as one query
    // regardless of collection size, not an N+1 full-document-scan concern).
    // The department doc's own `staffCount` field is written by the single-add
    // and bulk-import routes, but anything that touches `staff` outside those
    // two paths (a seed script, a future admin tool, a manual Firestore edit)
    // leaves it stale with no way for a reader to tell - trusting it here was
    // silently showing 0 for departments that actually have staff.
    const depts = await Promise.all(
      deptsSnap.docs.map(async (d) => {
        const data = d.data();
        let staffCount = 0;
        try {
          const countSnap = await db
            .collection("locations")
            .doc(locationId)
            .collection("staff")
            .where("departmentId", "==", d.id)
            .where("status", "==", "ACTIVE")
            .count()
            .get();
          staffCount = countSnap.data().count;
        } catch (err) {
          const badBody = badBodyResponse(err);
          if (badBody) return badBody;
          console.error("[location/departments GET] staff count failed for", d.id, err);
        }
        return {
          id: d.id,
          ...data,
          staffCount,
        };
      })
    );

    return NextResponse.json({ departments: depts });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    console.error("[location/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION", "LOCATION_STAFF_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await readJsonBody(request)) as {
      name: string;
      code?: string;
      description?: string;
      headUid?: string;
      headStaffId?: string;
      headName?: string;
      headEmail?: string;
      headPhone?: string;
      locationId?: string;
      loginCredentials?: { email: string; password: string };
    };
    const locationId = body.locationId || session.locationId;
    const name = body.name?.trim();
    const code = body.code?.trim() ? body.code.trim().toUpperCase() : "";

    if (!name || !locationId) {
      return NextResponse.json({ error: "name and locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const now = new Date();

    let resolvedHeadUid = body.headUid || null;
    let resolvedHeadEmail = body.headEmail?.trim() || null;
    let credentialsCreated = false;

    // Check if new login credentials should be created for this Department Head
    const creds = (body as { loginCredentials?: { email: string; password: string } }).loginCredentials;
    if (creds?.email && creds?.password) {
      const credEmail = creds.email.trim().toLowerCase();
      const credPassword = creds.password.trim();
      const displayName = body.headName?.trim() || name;

      const newUid = await createFirebaseUser(credEmail, credPassword, displayName);
      resolvedHeadUid = newUid;
      resolvedHeadEmail = credEmail;
      credentialsCreated = true;

      // Create location user record
      await db.collection("locations").doc(locationId).collection("locationUsers").doc(newUid).set({
        uid: newUid,
        locationId,
        name: displayName,
        email: credEmail,
        phone: body.headPhone?.trim() || "",
        role: "LOCATION_DEPT_HEAD",
        department: name,
        locationDeptId: "", // will update with ref.id below
        locationDeptIds: [],
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

    const deptPayload = {
      name,
      code,
      description: body.description?.trim() || "",
      locationId,
      headUid: resolvedHeadUid || body.headStaffId || null,
      headStaffId: body.headStaffId || null,
      headName: body.headName?.trim() || null,
      headEmail: resolvedHeadEmail,
      headPhone: body.headPhone?.trim() || null,
      isActive: true,
      staffCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .add(deptPayload);

    // If headStaffId was provided, update that staff member's department and link userUid
    if (body.headStaffId) {
      const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(body.headStaffId);
      const updateData: Record<string, unknown> = {
        departmentId: ref.id,
        departmentName: name,
        isDeptHead: true,
        updatedAt: now,
      };
      if (resolvedHeadUid) {
        updateData.userUid = resolvedHeadUid;
      }
      if (resolvedHeadEmail) {
        updateData.userEmail = resolvedHeadEmail;
      }
      await staffRef.set(updateData, { merge: true });
    }

    // Ensure user has locationDeptId / locationDeptIds set
    if (resolvedHeadUid) {
      const userRef = db.collection("locations").doc(locationId).collection("locationUsers").doc(resolvedHeadUid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const udata = userDoc.data() as { locationDeptIds?: string[] };
        const existingIds = udata.locationDeptIds ?? [];
        if (!existingIds.includes(ref.id)) {
          await userRef.set(
            {
              role: "LOCATION_DEPT_HEAD",
              locationDeptId: ref.id,
              locationDeptIds: [...existingIds, ref.id],
              department: name,
              updatedAt: now,
            },
            { merge: true }
          );
        }
      }
    }

    return NextResponse.json({
      id: ref.id,
      ...deptPayload,
      credentialsCreated,
      loginEmail: credentialsCreated ? resolvedHeadEmail : undefined,
    }, { status: 201 });
  } catch (err: unknown) {
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this login email already exists. Use a different email or select existing user." }, { status: 409 });
    }
    if (
      err && typeof err === "object" && "code" in err &&
      (err as { code: string }).code === "auth/weak-password"
    ) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    console.error("[location/departments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
