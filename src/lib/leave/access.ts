import type { Firestore } from "firebase-admin/firestore";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";

// Self always allowed; Principal/VP see everyone; HOD only their own department.
export async function canAccessLeaveProfile(
  db: Firestore,
  collegeId: string,
  role: string,
  callerUid: string,
  targetUid: string
): Promise<boolean> {
  if (targetUid === callerUid) return true;
  if (role === "PRINCIPAL" || role === "VICE_PRINCIPAL") return true;
  if (role === "HOD") {
    const hodDept = await resolveUserDepartment(db, collegeId, callerUid);
    const targetIdentity = await resolveEmployeeIdentity(db, collegeId, targetUid);
    return !!hodDept && targetIdentity?.department === hodDept;
  }
  return false;
}
