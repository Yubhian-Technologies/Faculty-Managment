import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types";

// Academic-leadership roles that resolveEmployeeIdentity (src/lib/leave/
// identity.ts) already treats as teaching-equivalent when they have no
// FacultyMember record of their own.
const ACADEMIC_LEADERSHIP_ROLES: UserRole[] = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "DEAN"];

// A publication belongs to the person's academic career, not whichever
// administrative role they happened to hold when it was added - Principal/
// VP/HOD/Dean are fundamentally faculty serving in an administrative
// capacity, and that capacity can change while the record must stay theirs.
// Resolves what to show INSTEAD of the raw functional role: their real
// designation if they still have a linked FacultyMember record, else a
// generic "Faculty" label for academic leadership, else undefined (genuine
// office roles - R&D, IQAC, T&P, Library, Exam Cell, Webmaster, College
// Office, College Staff - keep showing their actual role, unchanged).
export async function resolveOwnerDesignation(
  db: Firestore,
  collegeId: string,
  uid: string,
  role: UserRole
): Promise<string | undefined> {
  const facultySnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
    .where("userUid", "==", uid).limit(1).get();
  const designation = (facultySnap.docs[0]?.data() as { designation?: string } | undefined)?.designation;
  if (designation) return designation;

  return ACADEMIC_LEADERSHIP_ROLES.includes(role) ? "Faculty" : undefined;
}
