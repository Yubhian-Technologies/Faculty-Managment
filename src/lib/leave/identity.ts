import type { Firestore } from "firebase-admin/firestore";
import { isTeachingDesignation } from "@/lib/designations/config";
import type { CollegeType } from "@/types/core";

export interface ResolvedIdentity {
  name: string;
  department?: string;
  isTeachingStaff: boolean;
  dateOfJoining: Date;
}

// Three account shapes, checked in order:
//  - PANEL_MEMBER has a richer FacultyMember record (designation, joiningDate)
//  - COLLEGE_STAFF backed by a SupportingStaffMember record (Non-Technical
//    staff) - always non-teaching, uses its own joiningDate.
//  - Everyone else (HOD/PRINCIPAL/VICE_PRINCIPAL/DEAN, ACCOUNTS/FINANCE/
//    COLLEGE_OFFICE, IQAC_COORDINATOR/T_AND_P/R_AND_D, and any remaining
//    label-only COLLEGE_STAFF logins) has no FacultyMember/SupportingStaff
//    record - only a thin users/{uid} doc. isTeachingStaff is derived from
//    that doc's stored role: true for HOD/PRINCIPAL/VICE_PRINCIPAL/DEAN -
//    academic leadership gets the same "vacation" (teaching-staff)
//    entitlement as the faculty they lead (CL/SL/SCL/EL-6/OD), same as HOD
//    always has. Everyone else here (Accounts/Finance/College Office/IQAC/
//    T&P/R&D) is non-vacation. dateOfJoining falls back to when their login
//    was created.
export async function resolveEmployeeIdentity(
  db: Firestore,
  collegeId: string,
  uid: string
): Promise<ResolvedIdentity | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  const facultySnap = await collegeRef
    .collection("facultyMembers")
    .where("userUid", "==", uid)
    .limit(1)
    .get();

  if (!facultySnap.empty) {
    const f = facultySnap.docs[0].data() as {
      name: string;
      department?: string;
      designation: string;
      joiningDate?: { toDate(): Date };
    };
    // Vacation (classroom teaching) entitlement depends on the designation
    // being a teaching one for this college's type (see
    // src/lib/designations/config.ts) - every other FacultyMember
    // designation (e.g. a not-yet-migrated Lab Assistant, see
    // scripts/migrate-technical-staff-to-supporting-staff.mjs) is
    // non-vacation, same as all other supporting staff.
    const collegeSnap = await collegeRef.get();
    const collegeType = (collegeSnap.data() as { type?: CollegeType } | undefined)?.type;
    return {
      name: f.name,
      department: f.department,
      isTeachingStaff: isTeachingDesignation(f.designation, collegeType),
      dateOfJoining: f.joiningDate?.toDate?.() ?? new Date(),
    };
  }

  const supportingStaffSnap = await collegeRef
    .collection("supportingStaff")
    .where("userUid", "==", uid)
    .limit(1)
    .get();

  if (!supportingStaffSnap.empty) {
    const s = supportingStaffSnap.docs[0].data() as {
      name: string;
      department?: string;
      joiningDate?: { toDate(): Date };
    };
    return {
      name: s.name,
      department: s.department,
      isTeachingStaff: false,
      dateOfJoining: s.joiningDate?.toDate?.() ?? new Date(),
    };
  }

  const userSnap = await collegeRef.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;

  const u = userSnap.data() as {
    name?: string;
    department?: string;
    role?: string;
    createdAt?: { toDate(): Date };
  };
  const isAcademicLeadership = u.role === "HOD" || u.role === "PRINCIPAL" || u.role === "VICE_PRINCIPAL" || u.role === "DEAN";
  return {
    name: u.name ?? "Unknown",
    department: u.department,
    isTeachingStaff: isAcademicLeadership,
    // HOD/Principal/Vice Principal/Dean login accounts have no FacultyMember
    // record to source a real joining date from - falling back to this
    // login's own createdAt (as every other role here does) would wrongly
    // cycle a freshly-created account through the "new-joining" leave
    // category (computeEffectiveCategory in categoryEngine.ts: reduced CL,
    // no SL/SCL/EL) for a full newJoiningYears after every re-provisioned
    // login, even though nobody is appointed to these roles as a brand-new
    // hire. Back-date them well past any realistic newJoiningYears threshold
    // so they get the same "vacation" (teaching-staff) entitlements as
    // teaching faculty from day one - still correctable via the Leave
    // Profile edit screen if a college ever needs a real date on record.
    dateOfJoining: isAcademicLeadership
      ? new Date(new Date().getFullYear() - 50, 0, 1)
      : (u.createdAt?.toDate?.() ?? new Date()),
  };
}
