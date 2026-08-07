export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";

// Roster of department (HOD) or college-wide (Principal/VP) faculty AND
// Technical/Non-Technical supporting staff - every entry's leave profile is
// auto-created here if it doesn't already exist yet (from their
// FacultyMember/SupportingStaff designation), so there is never a "not set
// up" state to show - only ever an existing, editable profile. An HOD only
// owns Technical staff in their own department (same rule as everywhere else
// Supporting Staff is read - see src/lib/supportingStaff/roleCategory.ts);
// Principal/VP see every category, college-wide.
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
        .where("department", "==", dept || "__NO_DEPARTMENT__")
        .where("staffCategory", "==", "TECHNICAL");
    }

    const [facultySnap, staffSnap, settings] = await Promise.all([
      facultyQuery.get(),
      staffQuery.get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const facultyList = facultySnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((f) => !!f.userUid);
    const staffList = staffSnap.docs
      .map((d) => d.data() as { userUid?: string; name: string; department?: string; designation: string })
      .filter((s) => !!s.userUid);

    const roster = await Promise.all(
      [...facultyList, ...staffList].map(async (f) => {
        const profile = await getOrCreateProfile(db, session.collegeId, f.userUid!);
        return {
          uid: f.userUid!,
          name: f.name,
          department: f.department,
          designation: f.designation,
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
