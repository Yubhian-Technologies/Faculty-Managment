export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";

// Roster of department (HOD) or college-wide (Principal/VP) staff, split
// into the two tabs the UI shows: "Faculty" (Teaching designations only)
// and "Supporting Staff" (everything else). Technical designations (Lab
// Assistant/Programmer/System Administrator/Network Engineer,
// LEGACY_TECHNICAL_DESIGNATIONS) now belong in the Supporting Staff module,
// but any FacultyMember record not yet moved there by
// scripts/migrate-technical-staff-to-supporting-staff.mjs still has one of
// these designations - those still get tagged "supportingStaff" here so
// they show up on the right tab, dept-scoped for HOD and college-wide for
// Principal/VP - plus, for Principal/VP only, every record from the
// separate college-wide supportingStaff collection. Every entry's leave
// profile is auto-created here if it
// doesn't already exist yet (from their FacultyMember/SupportingStaff
// designation), so there is never a "not set up" state to show - only ever
// an existing, editable profile. staffType tags each entry "faculty" vs
// "supportingStaff" for the roster/report UI's tabs.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyMembersQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    if (session.role === "HOD") {
      const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
      facultyMembersQuery = facultyMembersQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
    }
    const supportingStaffQuery: FirebaseFirestore.Query | null =
      session.role === "HOD" ? null : collegeRef.collection("supportingStaff");

    const [facultyMembersSnap, supportingStaffSnap, settings] = await Promise.all([
      facultyMembersQuery.get(),
      supportingStaffQuery?.get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const facultyMembers = facultyMembersSnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid);
    const facultyList = facultyMembers
      .filter((f) => !LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation))
      .map((f) => ({ ...f, staffType: "faculty" as const }));
    // Not-yet-migrated FacultyMember records (see
    // scripts/migrate-technical-staff-to-supporting-staff.mjs) - still show
    // up on the Supporting Staff tab until that script moves them for real.
    const legacyTechnicalStaffList = facultyMembers
      .filter((f) => LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation))
      .map((f) => ({ ...f, staffType: "supportingStaff" as const }));
    const supportingStaffList = (supportingStaffSnap?.docs ?? [])
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid)
      .map((f) => ({ ...f, staffType: "supportingStaff" as const }));

    const roster = await Promise.all(
      [...facultyList, ...legacyTechnicalStaffList, ...supportingStaffList].map(async (f) => {
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
