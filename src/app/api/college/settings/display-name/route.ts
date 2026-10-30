export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { DISPLAY_NAME_SURFACES, normalizeDisplayNameSettings, readDisplayNameSettings } from "@/lib/faculty/displayNameSettings";

// colleges/{collegeId}/settings/displayName - where the college shows faculty Display Names instead of Full Names,
// set by the college admin (Principal / Vice Principal / College Admin) from Settings > Website Display Name.
// Read server-side by every place listed in DISPLAY_NAME_SURFACES (e.g. public/faculty-public).

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const snap = await getAdminDb()
      .collection("colleges").doc(session.collegeId)
      .collection("settings").doc("displayName")
      .get();
    // How many faculty have entered BOTH parts of their Display Name - a tick changes nothing for anyone who has not.
    const collegeRef = getAdminDb().collection("colleges").doc(session.collegeId);
    const filledSnap = await collegeRef.collection("facultyMembers").where("displaySurname", ">", "").select("displaySurname", "displayName").get();
    const filled = filledSnap.docs.filter((d) => {
      const f = d.data() as { displaySurname?: string; displayName?: string };
      return Boolean(f.displaySurname?.trim() && f.displayName?.trim());
    }).length;
    return NextResponse.json({ surfaces: readDisplayNameSettings(snap.data()), places: DISPLAY_NAME_SURFACES, filled });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/display-name GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { surfaces?: unknown };
    const result = normalizeDisplayNameSettings(body.surfaces);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const db = getAdminDb();
    const updatedByName = session.email || "College Admin";
    await db.collection("colleges").doc(session.collegeId).collection("settings").doc("displayName").set({
      surfaces: result.surfaces,
      updatedAt: new Date(),
      updatedByName,
    });
    await db.collection("auditLogs").add({
      action: "DISPLAY_NAME_SETTINGS_UPDATED",
      performedBy: session.uid,
      performedByName: updatedByName,
      details: { collegeId: session.collegeId, surfaces: result.surfaces },
      timestamp: new Date(),
    });
    return NextResponse.json({ success: true, surfaces: result.surfaces });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/display-name PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
