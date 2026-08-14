export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Top of the facial-attendance reset chain (Faculty <- HOD, HOD/VP <- Principal,
// see /api/college/attendance/face-registration/reset) - lets Management send
// that college's Principal back to "not registered" the same way, clearing
// only the stored embedding on their users/{uid} doc. Resolves "the"
// Principal by role the same way GET .../principal-attendance already does,
// since Management's session isn't scoped to any one college.
export async function POST(_request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const principalSnap = await collegeRef.collection("users").where("role", "==", "PRINCIPAL").limit(1).get();
    if (principalSnap.empty) {
      return NextResponse.json({ error: "No Principal is currently assigned at this college" }, { status: 404 });
    }

    await principalSnap.docs[0].ref.update({
      faceEmbedding: FieldValue.delete(),
      faceRegisteredAt: FieldValue.delete(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/principal-attendance/reset POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
