import type { Firestore } from "firebase-admin/firestore";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import type { Department, FacultyMember, FMSUser } from "@/types";

export interface ReportPerson {
  uid: string;
  employeeId: string;
  name: string;
  role: "HOD" | "PANEL_MEMBER";
}

export interface ReportRoster {
  department: Department;
  people: ReportPerson[];
}

// Shared by the monthly and yearly leave-history-report routes:
//  - PRINCIPAL/VICE_PRINCIPAL: pass ?departmentId=... (any department), roster
//    includes that department's HOD.
//  - HOD: no departmentId needed - self-resolves their own department, and
//    is excluded from their own roster (only their faculty's history).
export async function resolveReportRoster(
  db: Firestore,
  collegeId: string,
  session: { role: string; uid: string },
  searchParams: URLSearchParams
): Promise<ReportRoster | { error: string; status: number }> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  let department: Department;
  let includeHod = true;

  if (session.role === "HOD") {
    includeHod = false;
    const deptName = await resolveUserDepartment(db, collegeId, session.uid);
    if (!deptName) return { error: "No department assigned", status: 400 };
    const deptSnap = await collegeRef.collection("departments").where("name", "==", deptName).limit(1).get();
    if (deptSnap.empty) return { error: "Department not found", status: 404 };
    department = { id: deptSnap.docs[0].id, ...deptSnap.docs[0].data() } as Department;
  } else {
    const departmentId = searchParams.get("departmentId");
    if (!departmentId) return { error: "departmentId is required", status: 400 };
    const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
    if (!deptSnap.exists) return { error: "Department not found", status: 404 };
    department = { id: deptSnap.id, ...deptSnap.data() } as Department;
  }

  const [facultySnap, hodUserSnap] = await Promise.all([
    collegeRef.collection("facultyMembers").where("department", "==", department.name).get(),
    includeHod && department.hodUid ? collegeRef.collection("users").doc(department.hodUid).get() : Promise.resolve(null),
  ]);

  const people: ReportPerson[] = [];

  if (hodUserSnap?.exists) {
    const hod = hodUserSnap.data() as FMSUser;
    people.push({ uid: hodUserSnap.id, employeeId: hod.employeeId ?? "-", name: hod.name, role: "HOD" });
  }
  for (const d of facultySnap.docs) {
    const f = d.data() as FacultyMember;
    if (!f.userUid) continue; // no login -> no leave account to report on
    people.push({ uid: f.userUid, employeeId: f.employeeId, name: f.name, role: "PANEL_MEMBER" });
  }

  return { department, people };
}
