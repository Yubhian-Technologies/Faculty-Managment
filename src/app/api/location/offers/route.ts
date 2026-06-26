export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationOffers")
      .orderBy("createdAt", "desc")
      .get();

    type OfferDoc = { id: string; status: string; [key: string]: unknown };
    const offers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OfferDoc));

    // Administration sees only offers pending their approval
    if (session.role === "ADMINISTRATION") {
      return NextResponse.json({ offers: offers.filter((o) => o.status === "PENDING_ADMIN") });
    }

    return NextResponse.json({ offers });
  } catch (err) {
    console.error("[location/offers GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session || session.role !== "HR_ADMIN") {
      return NextResponse.json({ error: "Only HR Admin can create offer letters" }, { status: 403 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      candidateId: string;
      candidateName: string;
      candidateEmail: string;
      department: string;
      interviewId?: string;
      vacancyId?: string;
      joiningDate: string;
      salary: number;
      remarks?: string;
    };

    const { candidateId, candidateName, candidateEmail, department, joiningDate, salary } = body;
    if (!candidateId || !candidateName || !candidateEmail || !department || !joiningDate || !salary) {
      return NextResponse.json({ error: "candidateId, candidateName, candidateEmail, department, joiningDate, salary are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    const creatorSnap = await db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid).get();
    const creatorName = (creatorSnap.data() as { name?: string })?.name ?? session.email;

    const ref = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationOffers")
      .add({
        locationId: session.locationId,
        candidateId,
        candidateName: candidateName.trim(),
        candidateEmail: candidateEmail.trim().toLowerCase(),
        department: department.trim(),
        position: "Faculty",
        interviewId: body.interviewId ?? "",
        vacancyId: body.vacancyId ?? "",
        joiningDate: new Date(joiningDate),
        salary,
        remarks: body.remarks?.trim() ?? "",
        status: "PENDING_ADMIN",
        createdByUid: session.uid,
        createdByName: creatorName,
        createdAt: now,
        updatedAt: now,
      });

    // Update candidate status
    await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .doc(candidateId)
      .update({ status: "OFFER_PENDING", offerId: ref.id, updatedAt: now });

    // Notify Administration
    const adminSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .where("role", "==", "ADMINISTRATION")
      .get();

    const batch = db.batch();
    adminSnap.docs.forEach((d) => {
      const notifRef = db.collection("locations").doc(session.locationId).collection("locationNotifications").doc();
      batch.set(notifRef, {
        toUid: d.id,
        locationId: session.locationId,
        type: "OFFER_LETTER_GENERATED",
        title: "Offer Letter Awaiting Approval",
        message: `HR Admin has prepared an offer letter for ${candidateName} (${department}). Please review and approve.`,
        link: `/administration/offers/${ref.id}`,
        read: false,
        createdAt: now,
      });
    });
    await batch.commit();

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error("[location/offers POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
