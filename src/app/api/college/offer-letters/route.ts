export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "HOD", "SUPER_ADMIN", "ACCOUNTS", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .orderBy("generatedAt", "desc") as FirebaseFirestore.Query;

    if (batchId) query = query.where("batchId", "==", batchId);
    if (candidateId) query = query.where("candidateId", "==", candidateId);

    const snap = await query.get();
    const letters = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ letters });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      candidateId: string;
      batchId: string;
      candidateName: string;
      designation: string;
      department: string;
      joiningDate: string;
      ctcAnnual: number;
      subjects?: string[];
    };

    const { candidateId, batchId, candidateName, designation, department, joiningDate, ctcAnnual } = body;
    if (!candidateId || !batchId || !designation || !department || !joiningDate || !ctcAnnual) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    // Fetch actor name
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";

    const docRef = db.collection("colleges").doc(session.collegeId).collection("offerLetters").doc();
    const letter = {
      id: docRef.id,
      collegeId: session.collegeId,
      candidateId,
      batchId,
      candidateName,
      designation,
      department,
      joiningDate: new Date(joiningDate),
      ctcAnnual,
      subjects: body.subjects ?? [],
      status: "DRAFT",
      generatedBy: actorName,
      generatedByUid: session.uid,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(letter);

    // Notify candidate's HOD
    const batchSnap = await db.collection("colleges").doc(session.collegeId).collection("hiringBatches").doc(batchId).get();
    if (batchSnap.exists) {
      const batch = batchSnap.data() as { hodUid?: string; position?: string };
      if (batch.hodUid) {
        const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
        await notifRef.set({
          collegeId: session.collegeId,
          toUid: batch.hodUid,
          type: "OFFER_LETTER_CREATED",
          title: "Offer Letter Created",
          message: `An offer letter has been drafted for ${candidateName} (${batch.position ?? designation}).`,
          link: `/accounts/offers`,
          read: false,
          createdAt: now,
        });
      }
    }

    return NextResponse.json({ id: docRef.id, ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
