import type { Firestore } from "firebase-admin/firestore";
import { resolveHodDepartments } from "@/lib/budget/departmentScope";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";

// Self always allowed; Principal/VP/College Office see everyone; HOD only
// their own department.
export async function canAccessLeaveProfile(
  db: Firestore,
  collegeId: string,
  role: string,
  callerUid: string,
  targetUid: string
): Promise<boolean> {
  if (targetUid === callerUid) return true;
  if (role === "PRINCIPAL" || role === "VICE_PRINCIPAL" || role === "COLLEGE_OFFICE") return true;
  if (role === "HOD") {
    const hodDepts = await resolveHodDepartments(db, collegeId, callerUid);
    const targetIdentity = await resolveEmployeeIdentity(db, collegeId, targetUid);
    return !!targetIdentity?.department && hodDepts.includes(targetIdentity.department);
  }
  return false;
}
