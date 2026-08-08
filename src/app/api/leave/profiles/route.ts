export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";

// Roster of department (HOD) or college-wide (Principal/VP) faculty, plus
// Technical Supporting Staff (same HOD-owns-per-department / Principal-owns-
// college-wide split used on /hod/faculty vs /hod/supporting-staff) - every
// entry's leave profile is auto-created here if it doesn't already exist yet
// (from their FacultyMember/SupportingStaff record), so there is never a "not
// set up" state to show - only ever an existing, editable profile.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    let supportingStaffQuery: FirebaseFirestore.Query = collegeRef
      .collection("supportingStaff")
      .where("staffCategory", "==", "TECHNICAL");
    if (session.role === "HOD") {
      const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
      facultyQuery = facultyQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
      supportingStaffQuery = supportingStaffQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
    }

    const [facultySnap, supportingStaffSnap, settings] = await Promise.all([
      facultyQuery.get(),
      supportingStaffQuery.get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const facultyList = facultySnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => ({ ...f, staffType: "teaching" as const }));

    const supportingStaffList = supportingStaffSnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => ({ ...f, staffType: "technical" as const }));

    const roster = await Promise.all(
      [...facultyList, ...supportingStaffList].map(async (f) => {
        const profile = await getOrCreateProfile(db, session.collegeId, f.userUid!);
        return {
          uid: f.userUid!,
          name: f.name,
          department: f.department,
          designation: f.designation,
          staffType: f.staffType,
          staffCategory: profile?.staffCategory,
          effectiveCategory: profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : undefined,
        };
      })
    );
    roster.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ roster });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/profiles GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
