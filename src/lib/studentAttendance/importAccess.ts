import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodExclusivelyOwnDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { Section } from "@/types";

// Who may bulk-import past student attendance for a section: the College Office for any section, an HOD only for a
// section they manage - the same rule as editing that section (Sections: the year's owner - a 1st-year coordinator
// for the shared year, the branch's own HOD from the year it runs its own sections).
export async function mayImportSectionAttendance(
  db: FirebaseFirestore.Firestore, session: { collegeId: string; uid: string; role: string }, section: Section,
): Promise<boolean> {
  if (session.role !== "HOD") return true;
  const college = db.collection("colleges").doc(session.collegeId);
  const [scope, deptsSnap, courseSnap] = await Promise.all([
    getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false }),
    college.collection("departments").get(),
    section.courseId ? college.collection("courses").doc(section.courseId).get() : Promise.resolve(null),
  ]);
  const depts = deptsSnap.docs.map((d) => ({ ...(d.data() as DepartmentYearRow & { name?: string }), id: d.id }));
  const catalogId = (courseSnap?.data() as { catalogId?: string } | undefined)?.catalogId;
  return canHodExclusivelyOwnDepartmentYear(scope, depts, section.department, section.year, catalogId);
}
