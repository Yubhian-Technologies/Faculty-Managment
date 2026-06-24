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
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isHRAdmin = session.role === "HR_ADMIN";
    const isAdmin = session.role === "ADMINISTRATION";

    if (!isHRAdmin && !isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const { id } = await params;
    const body = (await request.json()) as { action?: string; status?: string; reason?: string };

    const db = getAdminDb();
    const docRef = db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationVacancyRequests")
      .doc(id);

    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const req = snap.data() as {
      deptHeadUid: string;
      deptHeadName: string;
      forwardedByUid?: string;
      department: string;
      requiredCount: number;
      status: string;
    };

    const now = new Date();

    // HR Admin: forward to Administration or reject
    if (isHRAdmin) {
      if (req.status !== "PENDING_HR") {
        return NextResponse.json({ error: "Request is not pending HR review" }, { status: 409 });
      }

      const hrSnap = await db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationUsers")
        .doc(session.uid)
        .get();
      const hrName = (hrSnap.data() as { name?: string } | undefined)?.name ?? "HR Admin";

      if (body.action === "FORWARD") {
        await docRef.update({
          status: "PENDING_ADMIN",
          forwardedByUid: session.uid,
          forwardedByName: hrName,
          hrForwardedAt: now,
          updatedAt: now,
        });

        // Notify Administration
        const adminsSnap = await db
          .collection("locations")
          .doc(session.locationId)
          .collection("locationUsers")
          .where("role", "==", "ADMINISTRATION")
          .get();

        const batch = db.batch();
        for (const admin of adminsSnap.docs) {
          const notifRef = db
            .collection("locations")
            .doc(session.locationId)
            .collection("locationNotifications")
            .doc();
          batch.set(notifRef, {
            locationId: session.locationId,
            toUid: admin.id,
            type: "VACANCY_REQUEST",
            title: "Faculty Vacancy Request Forwarded",
            message: `${hrName} forwarded a faculty vacancy request for ${req.department} (${req.requiredCount} position(s)) for your approval.`,
            link: "/administration/vacancies",
            read: false,
            createdAt: now,
          });
        }
        // Notify dept head
        const deptNotifRef = db
          .collection("locations")
          .doc(session.locationId)
          .collection("locationNotifications")
          .doc();
        batch.set(deptNotifRef, {
          locationId: session.locationId,
          toUid: req.deptHeadUid,
          type: "VACANCY_FORWARDED",
          title: "Vacancy Request Forwarded to Administration",
          message: `Your faculty vacancy request for ${req.department} has been forwarded to Administration by ${hrName}.`,
          link: "/location-dept-head/vacancies",
          read: false,
          createdAt: now,
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      if (body.action === "REJECT") {
        await docRef.update({
          status: "REJECTED",
          hrResponse: {
            action: "REJECTED",
            reason: body.reason ?? "",
            respondedAt: now,
            respondedByUid: session.uid,
            respondedByName: hrName,
          },
          updatedAt: now,
        });

        // Notify dept head
        await db
          .collection("locations")
          .doc(session.locationId)
          .collection("locationNotifications")
          .add({
            locationId: session.locationId,
            toUid: req.deptHeadUid,
            type: "VACANCY_REJECTED",
            title: "Vacancy Request Rejected by HR",
            message: `Your faculty vacancy request for ${req.department} was not forwarded by HR.${body.reason ? ` Reason: ${body.reason}` : ""}`,
            link: "/location-dept-head/vacancies",
            read: false,
            createdAt: now,
          });

        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ error: "action must be FORWARD or REJECT" }, { status: 400 });
    }

    // Administration: approve or reject
    if (isAdmin) {
      if (req.status !== "PENDING_ADMIN") {
        return NextResponse.json({ error: "Request is not pending Administration approval" }, { status: 409 });
      }

      const status = body.status;
      if (status !== "APPROVED" && status !== "REJECTED") {
        return NextResponse.json({ error: "status must be APPROVED or REJECTED" }, { status: 400 });
      }

      await docRef.update({
        status,
        administrationResponse: {
          action: status,
          reason: body.reason ?? "",
          respondedAt: now,
          respondedByUid: session.uid,
        },
        updatedAt: now,
      });

      const batch = db.batch();
      const notifTitle = status === "APPROVED" ? "Faculty Vacancy Approved" : "Faculty Vacancy Rejected";
      const notifType = status === "APPROVED" ? "VACANCY_APPROVED" : "VACANCY_REJECTED";

      // Notify HR Admin who forwarded
      if (req.forwardedByUid) {
        const hrNotif = db
          .collection("locations")
          .doc(session.locationId)
          .collection("locationNotifications")
          .doc();
        batch.set(hrNotif, {
          locationId: session.locationId,
          toUid: req.forwardedByUid,
          type: notifType,
          title: notifTitle,
          message: status === "APPROVED"
            ? `The faculty vacancy request for ${req.department} (${req.requiredCount} position(s)) has been approved.`
            : `The faculty vacancy request for ${req.department} was rejected.${body.reason ? ` Reason: ${body.reason}` : ""}`,
          link: "/hr-admin/vacancies",
          read: false,
          createdAt: now,
        });
      }

      // Notify dept head
      const deptNotif = db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationNotifications")
        .doc();
      batch.set(deptNotif, {
        locationId: session.locationId,
        toUid: req.deptHeadUid,
        type: notifType,
        title: notifTitle,
        message: status === "APPROVED"
          ? `Your faculty vacancy request for ${req.department} has been approved by Administration.`
          : `Your faculty vacancy request for ${req.department} was rejected by Administration.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        link: "/location-dept-head/vacancies",
        read: false,
        createdAt: now,
      });
      await batch.commit();

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  } catch (err) {
    console.error("[location/vacancy-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
