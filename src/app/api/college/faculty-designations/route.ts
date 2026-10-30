export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { designationLabel } from "@/lib/designations/config";

// GET ?ids=a,b,c -> { designations: { [id]: "Assistant Professor" } } - the designation printed beside a Class I/C name on
// timetables. Each id is what Section.facultyInchargeUid holds: the person's login uid or (older data) their faculty record id.
// Read from the faculty record (`designation`), else the login's own profile (HOD / Principal logins with no faculty record).
// Ids with no designation on file are simply left out. Read-only; nothing is stored.

const MAX_IDS = 60;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS", "FINANCE", "PURCHASE_DEPT",
      "COLLEGE_STAFF", "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER", "STUDENT",
      "CLASS_LEADER"
    );
    const ids = Array.from(new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))).slice(0, MAX_IDS);
    if (ids.length === 0) return NextResponse.json({ designations: {} });

    const collegeRef = getAdminDb().collection("colleges").doc(session.collegeId);
    const out: Record<string, string> = {};
    const put = (id: string, raw: unknown) => {
      if (out[id] || typeof raw !== "string" || !raw.trim()) return;
      const label = designationLabel(raw.trim());
      if (label && label !== "-") out[id] = label;
    };

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    await Promise.all(chunks.map(async (chunk) => {
      const byUid = await collegeRef.collection("facultyMembers").where("userUid", "in", chunk).get();
      for (const d of byUid.docs) put((d.data() as { userUid?: string }).userUid ?? d.id, d.data().designation);
    }));
    // Older sections hold the faculty record id itself.
    const missing = ids.filter((id) => !out[id]);
    if (missing.length) {
      const refs = missing.map((id) => collegeRef.collection("facultyMembers").doc(id));
      const docs = await getAdminDb().getAll(...refs);
      docs.forEach((d, i) => { if (d.exists) put(missing[i], d.data()?.designation); });
    }
    // Logins with no faculty record (HOD / Principal): the designation on their own profile.
    const stillMissing = ids.filter((id) => !out[id]);
    if (stillMissing.length) {
      const docs = await getAdminDb().getAll(...stillMissing.map((id) => collegeRef.collection("users").doc(id)));
      docs.forEach((d, i) => { if (d.exists) put(stillMissing[i], d.data()?.designation); });
    }
    return NextResponse.json({ designations: out });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-designations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
