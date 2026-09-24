export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getCircularPermissions, saveCircularPermissions } from "@/lib/circular/permissions";

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const db = getAdminDb();
    const perms = await getCircularPermissions(db, session.collegeId);
    return NextResponse.json({ permissions: perms ?? { allowedUids: [], allowedRoles: [] } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { allowedUids?: string[]; allowedRoles?: string[] };
    const db = getAdminDb();
    const perms = await saveCircularPermissions(db, session.collegeId, body.allowedUids ?? [], (body.allowedRoles ?? []) as never[], { uid: session.uid, name: (session as unknown as { name?: string }).name ?? "" });
    return NextResponse.json({ permissions: perms });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[circular-permissions POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
