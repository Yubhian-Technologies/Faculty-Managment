export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters") as FirebaseFirestore.Query;

    if (batchId) query = query.where("batchId", "==", batchId);
    if (candidateId) query = query.where("candidateId", "==", candidateId);

    const snap = await query.get();
    const letters = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = (a as { generatedAt?: { toMillis?: () => number } }).generatedAt?.toMillis?.() ?? 0;
        const tb = (b as { generatedAt?: { toMillis?: () => number } }).generatedAt?.toMillis?.() ?? 0;
        return tb - ta;
      });

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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACCOUNTS");
    const body = (await request.json()) as {
      candidateId: string;
      batchId: string;
      candidateName: string;
      designation: string;
      department: string;
      joiningDate: string;
      ctcAnnual: number;
      subjects?: string[];
      termsAndConditions?: string;
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
      ...(body.termsAndConditions?.trim() ? { termsAndConditions: body.termsAndConditions.trim() } : {}),
      // No separate draft/review step — HOD sends the offer in the same action.
      status: "SENT",
      generatedBy: actorName,
      generatedByUid: session.uid,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(letter);

    // Faculty account creation is deferred until the offer is accepted — see
    // "Create Faculty Account" on the Offer Letters list.

    // Notify candidate's HOD (e.g. Principal/VP sending on the HOD's behalf), and
    // resolve the panel + office staff email list for CC'ing the offer letter email.
    const batchSnap = await db.collection("colleges").doc(session.collegeId).collection("hiringBatches").doc(batchId).get();
    const ccEmails: string[] = [];
    if (batchSnap.exists) {
      const batch = batchSnap.data() as { hodUid?: string; position?: string; panelMemberUids?: string[] };
      if (batch.hodUid && batch.hodUid !== session.uid) {
        const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
        await notifRef.set({
          collegeId: session.collegeId,
          toUid: batch.hodUid,
          type: "OFFER_LETTER_CREATED",
          title: "Offer Letter Sent",
          message: `An offer letter has been sent to ${candidateName} (${batch.position ?? designation}).`,
          link: `/hod/offers`,
          read: false,
          createdAt: now,
        });
      }

      const usersColl = db.collection("colleges").doc(session.collegeId).collection("users");
      const panelUids = (batch.panelMemberUids ?? []).slice(0, 30); // Firestore 'in' cap
      const [panelSnap, officeSnap] = await Promise.all([
        panelUids.length > 0
          ? usersColl.where("__name__", "in", panelUids).get()
          : Promise.resolve(null),
        usersColl.where("role", "==", "COLLEGE_OFFICE").get(),
      ]);
      for (const d of [...(panelSnap?.docs ?? []), ...officeSnap.docs]) {
        const email = (d.data() as { email?: string }).email;
        if (email) ccEmails.push(email);
      }
    }

    return NextResponse.json({ id: docRef.id, ok: true, ccEmails: Array.from(new Set(ccEmails)) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
