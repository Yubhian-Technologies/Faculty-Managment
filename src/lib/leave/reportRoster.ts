import type { Firestore } from "firebase-admin/firestore";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { NON_DEPARTMENTAL_STAFF_ROLES } from "@/lib/leave/nonDepartmentalStaffRoles";
import { ROLE_LABELS } from "@/types";
import type { Department, FacultyMember, FMSUser, UserRole } from "@/types";

export interface ReportPerson {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
}

export interface ReportRoster {
  department: Department;
  people: ReportPerson[];
}

// Principal/VP-only: every login holding this one specific non-departmental
// role (Vice Principal, College Office, Dean, ...), college-wide (no
// department to scope by) - each such role gets its own card/register on the
// Leave History page rather than one combined list. The viewer's own login
// is excluded, same as an HOD never sees themself in their own department's
// register. `department` in the ReportRoster this feeds isn't real (there
// is none) and is never read by the pages that consume it - see
// LeaveHistoryReport's employeeHrefBase/apiUrl, which source the page title
// elsewhere - so a lightweight placeholder is enough to satisfy the shape.
export async function resolveStaffReportRoster(
  db: Firestore,
  collegeId: string,
  session: { role: string; uid: string },
  role: UserRole
): Promise<ReportRoster> {
  const usersSnap = await db.collection("colleges").doc(collegeId).collection("users")
    .where("role", "==", role)
    .get();

  const people: ReportPerson[] = usersSnap.docs
    .filter((d) => d.id !== session.uid)
    .map((d) => {
      const u = d.data() as FMSUser;
      return { uid: d.id, employeeId: u.employeeId ?? "-", name: u.name, role: u.role };
    });

  return {
    department: { id: role, name: ROLE_LABELS[role] } as Department,
    people,
  };
}

// Shared by the monthly and yearly leave-history-report routes:
//  - PRINCIPAL/VICE_PRINCIPAL: pass ?departmentId=... (any real department
//    id), or one of NON_DEPARTMENTAL_STAFF_ROLES's role codes (e.g.
//    "DEAN") for that role's own college-wide register instead (see
//    resolveStaffReportRoster).
//  - HOD: no departmentId needed - self-resolves their own department, and
//    is excluded from their own roster (only their faculty's history).
export async function resolveReportRoster(
  db: Firestore,
  collegeId: string,
  session: { role: string; uid: string },
  searchParams: URLSearchParams
): Promise<ReportRoster | { error: string; status: number }> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  const requestedDeptId = searchParams.get("departmentId");
  if (session.role !== "HOD" && NON_DEPARTMENTAL_STAFF_ROLES.includes(requestedDeptId as UserRole)) {
    return resolveStaffReportRoster(db, collegeId, session, requestedDeptId as UserRole);
  }

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
