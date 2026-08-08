export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";

// Roster of department (HOD) or college-wide (Principal/VP) faculty
// (teaching AND technical designations - see TECHNICAL_STAFF_DESIGNATIONS in
// core.ts) plus supporting staff - Principal/VP see every supportingStaff
// record college-wide (Technical and Non-Technical); an HOD sees their own
// department's faculty plus any leftover Technical supportingStaff records
// still scoped to their department (pre-existing records not yet migrated
// into facultyMembers via scripts/migrate-technical-staff-to-faculty.mjs -
// they stay visible/editable here until that migration runs). Non-Technical
// stays Principal/VP-only since it's college-wide, not HOD-owned. Every
// entry's leave profile is auto-created here if it doesn't already exist yet
// (from their FacultyMember/SupportingStaff designation), so there is never
// a "not set up" state to show - only ever an existing, editable profile.
// staffType tags each entry "faculty" vs "supportingStaff" for the roster/
// report UI's tabs.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    let staffQuery: FirebaseFirestore.Query = collegeRef.collection("supportingStaff");
    if (session.role === "HOD") {
      const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
      facultyQuery = facultyQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
      staffQuery = staffQuery
        .where("staffCategory", "==", "TECHNICAL")
        .where("department", "==", dept || "__NO_DEPARTMENT__");
    }

    const [facultySnap, staffSnap, settings] = await Promise.all([
      facultyQuery.get(),
      staffQuery.get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const facultyList = facultySnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => ({ ...f, staffType: "faculty" as const }));
    const staffList = staffSnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => ({ ...f, staffType: "supportingStaff" as const }));

    const roster = await Promise.all(
      [...facultyList, ...staffList].map(async (f) => {
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
