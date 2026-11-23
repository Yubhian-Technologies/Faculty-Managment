export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { exitedFacultyUids } from "@/lib/auth/readOnlyFacultyLookup";

// Who can sit on an interview panel HR schedules for a hiring request (names and roles only - not the staff
// accounts list): the request's HOD (always on it), the Principal / VP / College Admin / Director (ticked by
// default, as on the HOD's form), and the department's HODs and faculty with a login. Resigned / retired left out.
const DEFAULT_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "DIRECTOR"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HR", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const vacancyId = new URL(request.url).searchParams.get("vacancyId");
    if (!vacancyId) return NextResponse.json({ error: "Select a hiring request." }, { status: 400 });
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const v = await college.collection("vacancyRequests").doc(vacancyId).get();
    if (!v.exists) return NextResponse.json({ error: "Hiring request not found. It may have been deleted." }, { status: 404 });
    const department = String(v.get("department") ?? "");
    const hodUid = String(v.get("hodUid") ?? "");

    const usersSnap = await college.collection("users").select("name", "role", "department", "isActive").get();
    const exited = await exitedFacultyUids(db, session.collegeId).catch(() => new Set<string>());
    const people = usersSnap.docs
      .filter((d) => d.get("isActive") !== false && !exited.has(d.id))
      .map((d) => ({ uid: d.id, name: String(d.get("name") ?? ""), role: String(d.get("role") ?? ""), department: String(d.get("department") ?? "") }));
    const hod = people.find((p) => p.uid === hodUid) ?? (hodUid ? { uid: hodUid, name: String(v.get("hodName") ?? "HOD"), role: "HOD", department } : null);
    return NextResponse.json({
      hod,
      defaults: people.filter((p) => DEFAULT_ROLES.includes(p.role) && p.uid !== hodUid),
      faculty: people.filter((p) => ["HOD", "PANEL_MEMBER", "DEPARTMENT_OFFICE"].includes(p.role) && p.department === department && p.uid !== hodUid)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hr/panel-options GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
