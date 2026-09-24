export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getCircular } from "@/lib/circular/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const { id } = await params;
    const db = getAdminDb();
    const circular = await getCircular(db, session.collegeId, id);
    if (!circular) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Drafts only visible to creator/principal
    if (circular.status === "DRAFT" && circular.createdBy !== session.uid && session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ circular });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[circulars/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
