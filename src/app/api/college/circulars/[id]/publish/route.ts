export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canSendCircular } from "@/lib/circular/permissions";
import { publishCircular } from "@/lib/circular/service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const { id } = await params;
    const db = getAdminDb();
    const ok = await canSendCircular(db, session.collegeId, session.uid, session.role as never, (session as unknown as { realRole?: string }).realRole as never);
    if (!ok) return NextResponse.json({ error: "Not allowed to publish circulars" }, { status: 403 });
    const circular = await publishCircular(db, session.collegeId, id, { uid: session.uid, name: (session as unknown as { name?: string }).name ?? "" });
    return NextResponse.json({ circular });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[circulars publish POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
