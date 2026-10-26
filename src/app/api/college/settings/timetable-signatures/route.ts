export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeSignatureGroups, readSignatureGroups } from "@/lib/timetable/signatureAuthority";

// colleges/{collegeId}/settings/timetableSignatures - the signature authority
// printed under a college's timetables, set by the college admin (Principal /
// Vice Principal) from their Settings page. Read by GET /api/college/info.

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const collegeId = session.collegeId;

    const snap = await getAdminDb()
      .collection("colleges").doc(collegeId)
      .collection("settings").doc("timetableSignatures")
      .get();
    const data = snap.exists ? (snap.data() as { groups?: unknown; updatedByName?: string }) : undefined;
    return NextResponse.json({ groups: readSignatureGroups(data?.groups), updatedByName: data?.updatedByName });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/timetable-signatures GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { groups?: unknown };
    const collegeId = session.collegeId;
    const result = normalizeSignatureGroups(body.groups);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const db = getAdminDb();
    const updatedByName = session.email || "Super Admin";
    await db.collection("colleges").doc(collegeId).collection("settings").doc("timetableSignatures").set({
      groups: result.groups,
      updatedAt: new Date(),
      updatedByName,
    });

    await db.collection("auditLogs").add({
      action: "TIMETABLE_SIGNATURES_UPDATED",
      performedBy: session.uid,
      performedByName: updatedByName,
      details: { collegeId: collegeId, groups: result.groups },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true, groups: result.groups });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/timetable-signatures PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
