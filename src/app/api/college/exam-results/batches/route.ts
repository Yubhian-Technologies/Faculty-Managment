export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { batchesCol } from "@/lib/examResults/store";

// The Exam Cell's imported results sheets, newest first - drafts and published.

export async function GET() {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const snap = await batchesCol(getAdminDb(), session.collegeId).orderBy("createdAt", "desc").limit(300).get();
    return NextResponse.json({ batches: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/batches GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
