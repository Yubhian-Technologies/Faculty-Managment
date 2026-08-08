export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    // requireCollegeContext (not requireCollegeMember) so GLOBAL roles like
    // FINANCE/PURCHASE_DEPT/MANAGEMENT - whose collegeId comes from a query
    // param, not the session - can fetch their own notifications too.
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE",
      "PANEL_MEMBER", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT", "MANAGEMENT", "SUPER_ADMIN"
    );

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("notifications")
      .where("toUid", "==", session.uid)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    const notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ notifications });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ notifications: [] });
    }
    console.error("[notifications GET]", err);
    return NextResponse.json({ notifications: [] });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE",
      "PANEL_MEMBER", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT", "MANAGEMENT", "SUPER_ADMIN"
    );
    const body = (await request.json()) as { id?: string; markAll?: boolean };

    const db = getAdminDb();
    const col = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("notifications");

    if (body.markAll) {
      const snap = await col
        .where("toUid", "==", session.uid)
        .where("read", "==", false)
        .get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
      await batch.commit();
    } else if (body.id) {
      await col.doc(body.id).update({ read: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[notifications PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
