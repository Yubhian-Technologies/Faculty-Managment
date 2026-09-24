export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getCircularSettings, saveCircularSettings } from "@/lib/circular/settings";

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const db = getAdminDb();
    const settings = await getCircularSettings(db, session.collegeId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { messageFromOptions?: string[] };
    const db = getAdminDb();
    const settings = await saveCircularSettings(db, session.collegeId, body.messageFromOptions ?? [], { uid: session.uid, name: (session as unknown as { name?: string }).name ?? "" });
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && err.message.includes("At least one")) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
