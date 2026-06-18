export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// PATCH — Super Admin approves or rejects a General Admin vacancy request
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json()) as { status: string; reason?: string };
    const { status, reason } = body;

    if (!status) {
      return NextResponse.json({ error: "status required" }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection("generalAdminVacancies").doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const vacancy = snap.data() as {
      submittedByUid: string;
      collegeId: string;
      position: string;
    };
    const now = new Date();

    await docRef.update({
      status,
      superAdminResponse: {
        action: status,
        reason: reason ?? "",
        respondedAt: now,
        respondedByUid: session.uid,
      },
      updatedAt: now,
    });

    // Notify the Vice Principal who submitted
    if (vacancy.submittedByUid && vacancy.collegeId) {
      const notifTitle =
        status === "APPROVED" ? "General Admin Vacancy Approved" : "General Admin Vacancy Rejected";
      const notifMessage =
        status === "APPROVED"
          ? `Your General Admin vacancy request for ${vacancy.position} has been approved.`
          : `Your General Admin vacancy request for ${vacancy.position} was rejected.${reason ? ` Reason: ${reason}` : ""}`;

      await db
        .collection("colleges")
        .doc(vacancy.collegeId)
        .collection("notifications")
        .add({
          collegeId: vacancy.collegeId,
          toUid: vacancy.submittedByUid,
          type: status === "APPROVED" ? "VACANCY_APPROVED" : "VACANCY_REJECTED",
          title: notifTitle,
          message: notifMessage,
          link: "/principal/vacancies",
          read: false,
          createdAt: now,
        });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[general-admin-vacancies/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
