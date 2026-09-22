export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Every role that can be the recipient of something (e.g. College Staff / Dean
// can be named as a leave-adjustment substitute, R&D gets verification
// requests). Each caller still only ever reads notifications addressed to
// their own uid, so widening this list can't expose anyone else's.
const NOTIFICATION_ROLES = [
  "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE",
  "PANEL_MEMBER", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT", "MANAGEMENT", "SUPER_ADMIN",
  "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
  "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "COLLEGE_ACCOUNTS",
];

export async function GET(request: Request) {
  try {
    // requireCollegeContext (not requireCollegeMember) so GLOBAL roles like
    // FINANCE/PURCHASE_DEPT/MANAGEMENT - whose collegeId comes from a query
    // param, not the session - can fetch their own notifications too.
    const session = await requireCollegeContext(request, ...NOTIFICATION_ROLES);

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("notifications")
      .where("toUid", "==", session.uid)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    // Hides panel-stage prompts already stored for leadership roles before the
    // write-side fix (see excludeLeadershipUids in src/lib/notify.ts).
    const hidePanelPrompts = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN"].includes(session.role);
    const PANEL_PROMPT_TITLES = ["Panel Interview Scoring Open", "Panel Feedback Unlocked"];
    const notifications = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => {
        if (!hidePanelPrompts) return true;
        const { type, title } = n as { type?: string; title?: string };
        return type !== "CANDIDATE_ARRIVED" && !PANEL_PROMPT_TITLES.includes(title ?? "");
      });
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
    const session = await requireCollegeContext(request, ...NOTIFICATION_ROLES);
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
      const ref = col.doc(body.id);
      const doc = await ref.get();
      if (!doc.exists || (doc.data() as { toUid?: string }).toUid !== session.uid) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await ref.update({ read: true });
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
