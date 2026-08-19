import type { Firestore } from "firebase-admin/firestore";
import type { TimetableIncharge } from "@/types";

export function timetableInchargeDocId(courseId: string, year: number): string {
  return `${courseId}_year${year}`;
}

// Every Timetable/Teaching-Assignments write route checks this alongside its
// existing `session.role === "HOD"` + canHodEditDepartment scope check - the
// HOD keeps full access regardless (co-editors, not a handoff), this only
// ever ADDS a second way in for whoever the HOD delegated this exact
// course-year to. Never true for the HOD's own uid via this path - they're
// authorized through the normal HOD-scope branch instead.
export async function isTimetableIncharge(
  db: Firestore,
  collegeId: string,
  uid: string,
  courseId: string,
  year: number
): Promise<boolean> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("timetableIncharges").doc(timetableInchargeDocId(courseId, year))
    .get();
  if (!snap.exists) return false;
  return (snap.data() as TimetableIncharge).uid === uid;
}

// Whether `uid` is the Timetable Incharge for ANY course-year in
// `departmentName` - used where the action isn't tied to one specific
// course-year (e.g. fulfilling an incoming Faculty Assignment Request: the
// target department picks any of its own faculty, not necessarily for the
// course-year the Incharge was actually delegated). Deliberately coarser
// than isTimetableIncharge - being Incharge of even one course-year in a
// department is enough to act on that department's behalf here.
export async function isTimetableInchargeForDepartment(
  db: Firestore,
  collegeId: string,
  uid: string,
  departmentName: string
): Promise<boolean> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("timetableIncharges")
    .where("uid", "==", uid)
    .where("departmentName", "==", departmentName)
    .limit(1)
    .get();
  return !snap.empty;
}
