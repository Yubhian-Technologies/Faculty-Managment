export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(batchId)
      .collection("studentFeedback")
      .orderBy("submittedAt", "desc") as FirebaseFirestore.Query;

    if (candidateId) {
      query = query.where("candidateId", "==", candidateId);
    }

    const snap = await query.get();
    const feedback = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ feedback });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-feedback GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
