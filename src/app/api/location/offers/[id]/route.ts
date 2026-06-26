export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const doc = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationOffers")
      .doc(id)
      .get();

    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ offer: { id: doc.id, ...doc.data() } });
  } catch (err) {
    console.error("[location/offers/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      action: "APPROVE" | "REJECT";
      reason?: string;
    };

    if (!body.action) return NextResponse.json({ error: "action is required" }, { status: 400 });

    if (session.role !== "ADMINISTRATION") {
      return NextResponse.json({ error: "Only Administration can approve/reject offers" }, { status: 403 });
    }

    const db = getAdminDb();
    const ref = db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationOffers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    const offer = snap.data() as {
      status: string;
      candidateId: string;
      candidateName: string;
      candidateEmail: string;
    };

    if (offer.status !== "PENDING_ADMIN") {
      return NextResponse.json({ error: "Offer is not pending approval" }, { status: 400 });
    }

    const now = new Date();
    const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";

    const approverSnap = await db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid).get();
    const approverName = (approverSnap.data() as { name?: string })?.name ?? session.email;

    await ref.update({
      status: newStatus,
      approvedByUid: session.uid,
      approvedByName: approverName,
      rejectionReason: body.reason ?? "",
      updatedAt: now,
    });

    // Update candidate status
    await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .doc(offer.candidateId)
      .update({
        status: newStatus === "APPROVED" ? "OFFER_SENT" : "SELECTED",
        updatedAt: now,
      });

    // Notify HR Admin
    const hrSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .where("role", "==", "HR_ADMIN")
      .get();

    const batch = db.batch();
    hrSnap.docs.forEach((d) => {
      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        toUid: d.id,
        locationId: session.locationId,
        type: "OFFER_LETTER_GENERATED",
        title: newStatus === "APPROVED" ? "Offer Letter Approved" : "Offer Letter Rejected",
        message: `Administration has ${newStatus === "APPROVED" ? "approved" : "rejected"} the offer letter for ${offer.candidateName}.`,
        link: `/hr-admin/offers`,
        read: false,
        createdAt: now,
      });
    });
    await batch.commit();

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("[location/offers/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
