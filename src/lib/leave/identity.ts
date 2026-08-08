import type { Firestore } from "firebase-admin/firestore";

// Leave-module definition of "vacation staff" - stricter than core.ts's
// TEACHING_DESIGNATIONS (which also counts Lab Assistant toward faculty-ratio
// reporting elsewhere in the app). For leave purposes, vacation staff is only
// actual classroom teaching designations; every other FacultyMember
// designation (including Lab Assistant) is non-vacation, same as all other
// supporting staff.
const VACATION_DESIGNATIONS = [
  "PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "LECTURER", "VISITING_FACULTY", "ADJUNCT_FACULTY",
];

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
//  - Everyone else (HOD/PRINCIPAL/VICE_PRINCIPAL, ACCOUNTS/FINANCE/
//    COLLEGE_OFFICE, and label-only COLLEGE_STAFF logins like Dean/IQAC/T&P)
//    has no FacultyMember/SupportingStaff record - only a thin users/{uid}
//    doc. isTeachingStaff is derived from that doc's stored role: true only
//    for HOD (a working faculty member holding administrative charge, same
//    vacation entitlement as any other teaching designation). PRINCIPAL and
//    VICE_PRINCIPAL are full-time academic administrators, not classroom
//    faculty, so they get non-vacation entitlement (EL 30 instead of 6, no
//    SCL) just like Accounts/Finance/College Office/Dean. dateOfJoining
//    falls back to when their login was created.
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
    return {
      name: f.name,
      department: f.department,
      isTeachingStaff: VACATION_DESIGNATIONS.includes(f.designation),
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
  const isAcademicLeadership = u.role === "HOD" || u.role === "PRINCIPAL" || u.role === "VICE_PRINCIPAL";
  return {
    name: u.name ?? "Unknown",
    department: u.department,
    isTeachingStaff: u.role === "HOD",
    // HOD/Principal/Vice Principal login accounts have no FacultyMember
    // record to source a real joining date from - falling back to this
    // login's own createdAt (as every other role here does) would wrongly
    // cycle a freshly-created HOD/Principal/VP account through the
    // "new-joining" leave category (computeEffectiveCategory in
    // categoryEngine.ts: reduced CL, no SL/SCL/EL) for a full
    // newJoiningYears after every re-provisioned login, even though nobody
    // is appointed to these roles as a brand-new hire. Back-date them well
    // past any realistic newJoiningYears threshold so they get the same
    // "vacation" (teaching-staff) entitlements as teaching faculty from day
    // one - still correctable via the Leave Profile edit screen if a
    // college ever needs a real date on record.
    dateOfJoining: isAcademicLeadership
      ? new Date(new Date().getFullYear() - 50, 0, 1)
      : (u.createdAt?.toDate?.() ?? new Date()),
  };
}
