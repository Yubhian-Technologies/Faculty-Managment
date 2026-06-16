export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "HOD");
    const { uid } = await params;
    const body = (await request.json()) as { isActive: boolean };

    const db = getAdminDb();
    const auth = await getAdminAuth();

    // Fetch target user to verify scope
    const targetSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .get();

    if (!targetSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const target = targetSnap.data() as { role: string; department?: string };

    // PRINCIPAL can deactivate HOD and COLLEGE_OFFICE; HOD can only deactivate PANEL_MEMBER in their dept
    if (session.role === "PRINCIPAL") {
      if (!["HOD", "COLLEGE_OFFICE", "PANEL_MEMBER"].includes(target.role)) {
        return NextResponse.json({ error: "Cannot modify this user" }, { status: 403 });
      }
    } else if (session.role === "HOD") {
      if (target.role !== "PANEL_MEMBER") {
        return NextResponse.json({ error: "HOD can only manage Panel Members" }, { status: 403 });
      }
      // Verify same department
      const hodSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept && target.department !== hodDept) {
        return NextResponse.json({ error: "Can only manage faculty in your department" }, { status: 403 });
      }
    }

    const now = new Date();
    await auth.updateUser(uid, { disabled: !body.isActive });
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .update({ isActive: body.isActive, updatedAt: now });

    const action = body.isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED";
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
      details: { isActive: body.isActive, role: target.role },
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
