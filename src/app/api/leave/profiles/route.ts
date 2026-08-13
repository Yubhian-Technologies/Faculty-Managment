export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";
import { NON_DEPARTMENTAL_STAFF_ROLES } from "@/lib/leave/nonDepartmentalStaffRoles";
import { ROLE_LABELS } from "@/types";

// Roster of department (HOD) or college-wide (Principal/VP/College Office)
// staff, split into the three tabs the UI shows: "Faculty" (Teaching
// designations only), "Supporting Staff" (everything else with a
// FacultyMember/SupportingStaff record) and "Institutional Staff"
// (non-HOD callers only - Vice Principal, College Office, Dean, IQAC
// Coordinator, T&P, R&D, Library, Exam Cell, Webmaster; see
// NON_DEPARTMENTAL_STAFF_ROLES). Technical designations (Lab
// Assistant/Programmer/System Administrator/Network Engineer,
// LEGACY_TECHNICAL_DESIGNATIONS) now belong in the Supporting Staff module,
// but any FacultyMember record not yet moved there by
// scripts/migrate-technical-staff-to-supporting-staff.mjs still has one of
// these designations - those still get tagged "supportingStaff" here so
// they show up on the right tab, dept-scoped for HOD and college-wide for
// everyone else - plus, for non-HOD callers, every record from the
// separate college-wide supportingStaff collection, and every login holding
// a NON_DEPARTMENTAL_STAFF_ROLES role (these never belong to a department,
// so an HOD - department-scoped only - never sees them at all, same gating
// as the Leave History page's per-role registers - see reportRoster.ts).
// Every entry's leave profile is auto-created here if it doesn't already
// exist yet (from their FacultyMember/SupportingStaff/role default), so
// there is never a "not set up" state to show - only ever an existing,
// editable profile. staffType tags each entry
// "faculty"/"supportingStaff"/"institutional" for the roster/report UI's tabs.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyMembersQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    if (session.role === "HOD") {
      const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
      facultyMembersQuery = facultyMembersQuery.where("department", "==", dept || "__NO_DEPARTMENT__");
    }
    const supportingStaffQuery: FirebaseFirestore.Query | null =
      session.role === "HOD" ? null : collegeRef.collection("supportingStaff");
    const institutionalStaffQuery: FirebaseFirestore.Query | null =
      session.role === "HOD" ? null : collegeRef.collection("users").where("role", "in", NON_DEPARTMENTAL_STAFF_ROLES);

    const [facultyMembersSnap, supportingStaffSnap, institutionalStaffSnap, settings] = await Promise.all([
      facultyMembersQuery.get(),
      supportingStaffQuery?.get(),
      institutionalStaffQuery?.get(),
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
    // No department (these roles are college-wide) and no designation of
    // their own to show - the role itself (e.g. "R&D", "Dean") is the
    // closest thing, same as reportRoster.ts's own-role registers. Excludes
    // the viewer's own login (relevant when a Vice Principal, itself one of
    // NON_DEPARTMENTAL_STAFF_ROLES, is browsing) - nobody edits their own
    // leave category from someone else's roster view. Also excludes anyone
    // already listed under Supporting Staff - COLLEGE_STAFF (Non-Technical)
    // is itself in NON_DEPARTMENTAL_STAFF_ROLES, so a COLLEGE_STAFF login
    // with a real SupportingStaffMember record would otherwise show up
    // twice: once correctly under Supporting Staff, once again here with
    // just its role label ("College Staff") standing in for a designation.
    const supportingStaffUids = new Set(supportingStaffList.map((f) => f.userUid));
    const institutionalStaffList = (institutionalStaffSnap?.docs ?? [])
      .filter((d) => d.id !== session.uid && !supportingStaffUids.has(d.id))
      .map((d) => {
        const u = d.data() as { name?: string; role?: string };
        return { userUid: d.id, name: u.name ?? "Unknown", department: undefined, designation: ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role ?? "-", staffType: "institutional" as const };
      });

    const roster = await Promise.all(
      [...facultyList, ...legacyTechnicalStaffList, ...supportingStaffList, ...institutionalStaffList].map(async (f) => {
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
