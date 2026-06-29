export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { EmployeeLeaveProfile } from "@/types/leave";
import { PROFILES_COL } from "@/lib/leave/balanceEngine";

// GET /api/leave/profiles — returns all profiles for HOD's dept (or all for Principal)
// Also returns the uid list of faculty without profiles so HOD can identify who needs setup.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const dept = searchParams.get("dept") === "true";

    const db = getAdminDb();

    // Fetch all faculty (PANEL_MEMBER) in the college
    const usersSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("users")
      .where("role", "==", "PANEL_MEMBER")
      .get();

    type FacultyDoc = { uid: string; name?: string; department?: string; role?: string };
    let faculty: FacultyDoc[] = usersSnap.docs.map((d) => ({
      uid: d.id,
      ...(d.data() as Omit<FacultyDoc, "uid">),
    }));

    // HOD filters to their own department
    if (session.role === "HOD" || dept) {
      const hodSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("users").doc(session.uid).get();
      const hodDept = (hodSnap.data() as { department?: string })?.department ?? "";
      faculty = faculty.filter((f) => f.department === hodDept);
    }

    const uids = faculty.map((f) => f.uid);

    // Batch-fetch existing profiles (Firestore limits: 30 per `in` query)
    const profiles: EmployeeLeaveProfile[] = [];
    const CHUNK = 30;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const chunk = uids.slice(i, i + CHUNK);
      if (chunk.length === 0) break;
      const snap = await PROFILES_COL(session.collegeId, db).where("uid", "in", chunk).get();
      snap.docs.forEach((d) => profiles.push({ id: d.id, ...d.data() } as EmployeeLeaveProfile));
    }

    const profiledUids = new Set(profiles.map((p) => p.uid));
    const withoutProfiles = faculty.filter((f) => !profiledUids.has(f.uid));

    return NextResponse.json({ faculty, profiles, withoutProfiles });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profiles GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
