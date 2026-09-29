export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { StudentDocument } from "@/types";

// Student's own documents - resolved from session.uid only, same pattern as
// every other student/me/* route.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json({ documents: [] });
    }
    const studentId = studentSnap.docs[0].id;

    const snap = await collegeRef
      .collection("studentDocuments")
      .where("studentId", "==", studentId)
      .orderBy("createdAt", "desc")
      .get();
    return NextResponse.json({ documents: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StudentDocument) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/documents GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
