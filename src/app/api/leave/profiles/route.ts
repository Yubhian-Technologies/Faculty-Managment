export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import type { EmployeeLeaveProfile } from "@/types/leave";

// Roster of department (HOD) or college-wide (Principal/VP) faculty, joined
// with their leave profile setup status - drives /hod/leave/profiles.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    if (session.role === "HOD") {
      const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
      facultyQuery = facultyQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
    }

    const [facultySnap, profilesSnap, settings] = await Promise.all([
      facultyQuery.get(),
      collegeRef.collection("employeeLeaveProfiles").get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const profilesByUid = new Map<string, EmployeeLeaveProfile>();
    profilesSnap.docs.forEach((d) => profilesByUid.set(d.id, { id: d.id, ...d.data() } as EmployeeLeaveProfile));

    const roster = facultySnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => {
        const profile = profilesByUid.get(f.userUid!);
        return {
          uid: f.userUid!,
          name: f.name,
          department: f.department,
          designation: f.designation,
          hasProfile: !!profile,
          staffCategory: profile?.staffCategory,
          effectiveCategory: profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : undefined,
        };
      });

    return NextResponse.json({ roster });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profiles GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
