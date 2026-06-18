export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (!session || session.role !== "ADMINISTRATION") {
      return NextResponse.json({ error: "Only Administration can action location vacancy requests" }, { status: 403 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const { id } = await params;
    const body = (await request.json()) as { status: string; reason?: string };
    const { status, reason } = body;
    if (!status) return NextResponse.json({ error: "status required" }, { status: 400 });

    const db = getAdminDb();
    const docRef = db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationVacancyRequests")
      .doc(id);

    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const req = snap.data() as { submittedByUid: string; position: string };
    const now = new Date();

    await docRef.update({
      status,
      administrationResponse: {
        action: status,
        reason: reason ?? "",
        respondedAt: now,
        respondedByUid: session.uid,
      },
      updatedAt: now,
    });

    // Notify the HR Admin who submitted
    if (req.submittedByUid) {
      await db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationNotifications")
        .add({
          locationId: session.locationId,
          toUid: req.submittedByUid,
          type: status === "APPROVED" ? "VACANCY_APPROVED" : "VACANCY_REJECTED",
          title: status === "APPROVED" ? "Vacancy Request Approved" : "Vacancy Request Rejected",
          message: status === "APPROVED"
            ? `Your vacancy request for ${req.position} was approved. You may now open the job posting.`
            : `Your vacancy request for ${req.position} was rejected.${reason ? ` Reason: ${reason}` : ""}`,
          link: "/hr-admin/vacancies",
          read: false,
          createdAt: now,
        });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[location/vacancy-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
