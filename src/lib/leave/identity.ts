import type { Firestore } from "firebase-admin/firestore";
import { TEACHING_DESIGNATIONS } from "@/types/core";

export interface ResolvedIdentity {
  name: string;
  department?: string;
  isTeachingStaff: boolean;
  dateOfJoining: Date;
}

// Three account shapes, checked in order:
//  - PANEL_MEMBER has a richer FacultyMember record (designation, joiningDate)
//  - COLLEGE_STAFF backed by a SupportingStaffMember record (technical/non-
//    technical staff) - always non-teaching, uses its own joiningDate.
//  - Everyone else (HOD/PRINCIPAL/VICE_PRINCIPAL, ACCOUNTS/FINANCE/
//    COLLEGE_OFFICE, and label-only COLLEGE_STAFF logins like Dean/IQAC/T&P)
//    has no FacultyMember/SupportingStaff record - only a thin users/{uid}
//    doc. isTeachingStaff is derived from that doc's stored role: true only
//    for academic leadership (HOD/PRINCIPAL/VICE_PRINCIPAL). dateOfJoining
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
      isTeachingStaff: (TEACHING_DESIGNATIONS as string[]).includes(f.designation),
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
    isTeachingStaff: isAcademicLeadership,
    dateOfJoining: u.createdAt?.toDate?.() ?? new Date(),
  };
}
