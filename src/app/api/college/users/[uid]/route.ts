export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { syncDepartmentHod, getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";

async function loadTargetInScope(
  db: FirebaseFirestore.Firestore,
  session: { collegeId: string; role: string; uid: string },
  uid: string
) {
  const targetSnap = await db
    .collection("colleges")
    .doc(session.collegeId)
    .collection("users")
    .doc(uid)
    .get();

  if (!targetSnap.exists) return { targetSnap: null, error: "User not found" as const, status: 404 };

  const target = targetSnap.data() as { role: string; department?: string };

  if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
    // Matches CREATABLE_ROLES in principal/staff/new/page.tsx - every role a
    // Principal/VP can create here, they can also view/edit/deactivate.
    if (!["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "PANEL_MEMBER", "WEBMASTER", "COLLEGE_ACCOUNTS"].includes(target.role)) {
      return { targetSnap: null, error: "Cannot access this user", status: 403 };
    }
  } else if (session.role === "HOD") {
    if (target.role !== "PANEL_MEMBER" && target.role !== "CLASS_LEADER") {
      return { targetSnap: null, error: "HOD can only manage Panel Members and Class Leaders", status: 403 };
    }
    if (target.role === "CLASS_LEADER") {
      // Class Leader logins are bound to a Section (see users POST), not a
      // flat department name match - a Section can belong to a sub-department,
      // so this needs the same sub-department-aware check the creation path
      // uses (canHodEditDepartment), not the simple equality below.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, target.department ?? "")) {
        return { targetSnap: null, error: "Can only manage Class Leaders in your department", status: 403 };
      }
    } else {
      const hodSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept && target.department !== hodDept) {
        return { targetSnap: null, error: "Can only manage faculty in your department", status: 403 };
      }
    }
  } else if (session.role === "COLLEGE_OFFICE") {
    if (target.role !== "CLASS_LEADER") {
      return { targetSnap: null, error: "College Office can only manage Class Leaders", status: 403 };
    }
  }

  return { targetSnap, error: null, status: 200 };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    const { uid } = await params;
    const db = getAdminDb();

    const { targetSnap, error, status } = await loadTargetInScope(db, session, uid);
    if (!targetSnap) return NextResponse.json({ error }, { status });

    return NextResponse.json({ user: { uid: targetSnap.id, ...targetSnap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    const { uid } = await params;
    const body = (await request.json()) as Partial<{
      isActive: boolean;
      name: string;
      email: string;
      collegeEmail: string;
      employeeId: string;
      department: string;
      phone: string;
      academicProfile: Record<string, unknown>;
      profilePhotoUrl: string;
      newPassword: string;
    }> & PersonalDetailsInput;

    if (body.newPassword !== undefined && body.newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const db = getAdminDb();

    const { targetSnap, error, status } = await loadTargetInScope(db, session, uid);
    if (!targetSnap) return NextResponse.json({ error }, { status });
    const target = targetSnap.data() as { role: string; sectionId?: string; name?: string; department?: string };

    if (body.newPassword !== undefined) {
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const auth = await getAdminAuth();
      await auth.updateUser(uid, { password: body.newPassword });
    }

    // Empty string clears the photo - everything else must be a real upload of ours.
    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${uid}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now, ...buildPersonalDetailsUpdate(body) };

    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.name !== undefined && body.name.trim()) updates.name = body.name.trim();
    if (body.email !== undefined && body.email.trim()) updates.email = body.email.trim();
    if (body.collegeEmail !== undefined) updates.collegeEmail = body.collegeEmail;
    if (body.employeeId !== undefined) updates.employeeId = body.employeeId;
    if (body.department !== undefined) updates.department = body.department;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.academicProfile !== undefined) updates.academicProfile = body.academicProfile;
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .update(updates);

    if (body.department !== undefined) {
      await syncDepartmentHod(db, session.collegeId, {
        uid,
        role: target.role,
        name: (updates.name as string | undefined) ?? target.name ?? "",
        department: body.department,
      });
    }

    // Keep systemUsers in sync (name/photo are the only fields mirrored there)
    if ((body.name !== undefined && body.name.trim()) || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(uid).set(
        {
          ...(body.name !== undefined && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    // Deactivating a Class Leader frees up its Section for a new one.
    if (body.isActive === false && target.role === "CLASS_LEADER" && target.sectionId) {
      await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("sections")
        .doc(target.sectionId)
        .update({ classLeaderUid: FieldValue.delete(), classLeaderName: FieldValue.delete(), updatedAt: now });
    }

    const action = body.isActive === false ? "USER_DEACTIVATED" : body.isActive === true ? "USER_REACTIVATED" : "USER_UPDATED";
    let actorName = "Unknown";
    try {
      const actorSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action,
      performedBy: session.uid,
      performedByName: actorName,
      targetId: uid,
      details: { role: target.role },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
