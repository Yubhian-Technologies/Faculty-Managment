import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canSendCircular } from "@/lib/circular/permissions";

export const dynamic = "force-dynamic";

// GET /api/college/circulars/permissions/me
// Tells the current login whether they may author/publish college circulars -
// the same canSendCircular() evaluation the POST /publish routes enforce
// server-side (Principal/VP always; others per the circularPermissions doc).
// Read-only UI helper so the sidebar can hide the Circulars tab for users who
// were never assigned it; it grants nothing by itself.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS"
    );
    const db = getAdminDb();
    const canSend = await canSendCircular(
      db,
      session.collegeId,
      session.uid,
      session.role as never,
      (session as unknown as { realRole?: string }).realRole as never
    );
    return NextResponse.json({ canSend });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[circulars/permissions/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
