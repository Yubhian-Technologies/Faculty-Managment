export const dynamic = "force-dynamic";

// This route handles the HIRING salary agreement (the salary negotiated at the end
// of the recruitment process). Stored in `hiringSalaryAgreements` collection.
// Monthly payroll records live in a separate `salaryRecords` collection (Payroll module).

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  if (!collegeId || !uid) return "Unknown";
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "HOD", "SUPER_ADMIN", "ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const candidateId = searchParams.get("candidateId");
    const batchId = searchParams.get("batchId");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringSalaryAgreements")
      .orderBy("createdAt", "desc")
      .get();

    let records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (candidateId) records = records.filter((r) => (r as { candidateId?: string }).candidateId === candidateId);
    if (batchId) records = records.filter((r) => (r as { batchId?: string }).batchId === batchId);

    return NextResponse.json({ records });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-records GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      candidateId: string;
      batchId: string;
      candidateName: string;
      agreedMonthly: number;
      agreedAnnual: number;
      breakdown: {
        basic: number;
        hra: number;
        da: number;
        ta: number;
        medicalAllowance: number;
        otherAllowances: number;
        pf: number;
        professionalTax: number;
        tds: number;
      };
    };

    const { candidateId, batchId, candidateName, agreedMonthly, agreedAnnual, breakdown } = body;
    if (!candidateId || !batchId || !agreedMonthly || !agreedAnnual) {
      return NextResponse.json(
        { error: "candidateId, batchId, agreedMonthly, agreedAnnual required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const negotiatedBy = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    // Upsert: remove any existing agreement for this candidate
    const existingSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringSalaryAgreements")
      .where("candidateId", "==", candidateId)
      .get();
    for (const d of existingSnap.docs) await d.ref.delete();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringSalaryAgreements")
      .add({
        collegeId: session.collegeId,
        candidateId,
        batchId,
        candidateName: candidateName ?? "",
        agreedMonthly: Number(agreedMonthly),
        agreedAnnual: Number(agreedAnnual),
        breakdown: breakdown ?? {},
        negotiatedBy,
        negotiatedByUid: session.uid,
        agreedAt: now,
        createdAt: now,
      });

    // Advance candidate to DOCUMENT_VERIFICATION stage
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(candidateId)
      .update({ currentStage: "DOCUMENT_VERIFICATION", updatedAt: now });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "SALARY_RECORDED",
      performedBy: session.uid,
      performedByName: negotiatedBy,
      targetId: ref.id,
      details: { candidateId, agreedMonthly, agreedAnnual },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-records POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
