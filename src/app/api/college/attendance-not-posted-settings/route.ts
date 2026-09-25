export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getNotPostedSettings, saveNotPostedSettings } from "@/lib/attendance/notPostedSettings";

// Read: any college member with an attendance-reports view can see whether
// the reminder is on and when it fires. Write: PRINCIPAL/VICE_PRINCIPAL only
// - College Admin's session reads role="PRINCIPAL" (see isCollegeAdmin's own
// doc-comment elsewhere in this codebase), so this is exactly "College Admin
// can set a time" without a separate role branch.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER");
    const db = getAdminDb();
    const settings = await getNotPostedSettings(db, session.collegeId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { enabled?: boolean; cutoffTime?: string };
    if (!body.cutoffTime || !/^\d{2}:\d{2}$/.test(body.cutoffTime)) {
      return NextResponse.json({ error: "cutoffTime must be a valid HH:MM time" }, { status: 400 });
    }
    const db = getAdminDb();
    const settings = await saveNotPostedSettings(
      db,
      session.collegeId,
      { enabled: !!body.enabled, cutoffTime: body.cutoffTime },
      { uid: session.uid, name: (session as unknown as { name?: string }).name ?? "" }
    );
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && err.message.includes("HH:MM")) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[attendance-not-posted-settings PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
