import { getAdminDb } from "@/lib/firebase/admin";
import { inheritedAssignmentDepartmentId } from "@/lib/timetable/sharedYearTiming";
import type { Course, Department, Subject, SubjectSemesterAssignment, TeachingAssignment } from "@/types";

/**
 * The exact SubjectSemesterAssignment document a master subject becomes
 * once placed into one department's course-year-semester. Built only by
 * SubjectAssignService (assign by code), so every instance is field-for-field
 * the shape every downstream reader (Teaching Assignments, HOD Subjects,
 * sections) expects.
 */
export function buildSubjectInstancePayload(
  master: Subject,
  options: {
    collegeId: string;
    subjectId: string;
    courseId: string;
    departmentId: string;
    departmentName?: string;
    year: number;
    semester: number;
    customOverrides?: { lectureHours?: number; tutorialHours?: number; practicalHours?: number; credits?: number };
    createdAt: unknown;
    now: Date;
    /** This assignment's own position (see SubjectSemesterAssignment.serialNumber). */
    serialNumber?: number;
  }
): SubjectSemesterAssignment {
  const { collegeId, subjectId, courseId, departmentId, departmentName, year, semester, customOverrides } = options;
  // Hours & credits, allowing department overrides if provided.
  const lectureHours = customOverrides?.lectureHours ?? master.lectureHours ?? 0;
  const tutorialHours = customOverrides?.tutorialHours ?? master.tutorialHours ?? 0;
  const practicalHours = customOverrides?.practicalHours ?? master.practicalHours ?? 0;
  const hoursPerWeek = lectureHours + tutorialHours + practicalHours;
  const credits = customOverrides?.credits ?? master.credits ?? 0;

  return {
    id: `${subjectId}_${departmentId}_${semester}`,
    collegeId,
    subjectId,
    masterSubjectId: subjectId,
    subjectName: master.name ?? "",
    subjectCode: master.code ?? "",
    ...(options.serialNumber != null ? { serialNumber: options.serialNumber } : {}),
    ...(master.shortCode ? { shortCode: master.shortCode } : {}),
    courseId,
    courseName: master.courseName ?? "",
    academicYear: master.academicYear ?? "",
    regulation: master.regulation ?? "",
    year,
    departmentId,
    departmentName: departmentName ?? master.courseName ?? "",
    semester,

    // Snapshot attributes copied from Master
    type: master.type ?? "THEORY",
    ...(master.category ? { category: master.category } : {}),
    ...(master.customCategory ? { customCategory: master.customCategory } : {}),
    lectureHours,
    tutorialHours,
    practicalHours,
    hoursPerWeek,
    totalHoursPerSemester: master.totalHoursPerSemester ?? null,
    credits,
    ...(master.internalMarks != null ? { internalMarks: master.internalMarks } : {}),
    ...(master.externalMarks != null ? { externalMarks: master.externalMarks } : {}),
    ...(master.totalMarks != null ? { totalMarks: master.totalMarks } : {}),
    ...(master.isCustom ? { isCustom: master.isCustom } : {}),
    ...(master.isNonTeachingLoad ? { isNonTeachingLoad: master.isNonTeachingLoad } : {}),
    ...(master.excludeFromResume ? { excludeFromResume: master.excludeFromResume } : {}),
    isActive: true,
    createdAt: options.createdAt as SubjectSemesterAssignment["createdAt"],
    updatedAt: options.now as unknown as SubjectSemesterAssignment["updatedAt"],
  };
}

/**
 * Whether a live teaching assignment depends on this semester instance -
 * the same lookup teaching-assignments/route.ts POST uses to accept it: the
 * instance's department is the section course's department, the section's
 * own department (a sub-department running on its parent's course), or the
 * shared-first-year managing department; same semester (section-scoped
 * assignments store it as `timetableSemester`) and same year.
 */
export function teachingAssignmentUsesInstance(
  ta: Pick<TeachingAssignment, "isPast" | "sectionId" | "courseId" | "year" | "department" | "departmentId" | "timetableSemester" | "semester">,
  instance: { departmentId: string; semester: number; year?: number },
  departments: (Department & { id: string })[],
  coursesById: Map<string, Pick<Course, "departmentId" | "catalogId">>
): boolean {
  if (ta.isPast) return false;
  // Legacy semester-scoped shape: no section, semester stored directly.
  if (!ta.sectionId) return ta.departmentId === instance.departmentId && ta.semester === instance.semester;
  if (ta.timetableSemester != null && ta.timetableSemester !== instance.semester) return false;
  if (instance.year != null && ta.year != null && Number(ta.year) !== Number(instance.year)) return false;
  const course = ta.courseId ? coursesById.get(ta.courseId) : undefined;
  const candidates = new Set<string>();
  if (course?.departmentId) candidates.add(course.departmentId);
  if (ta.departmentId) candidates.add(ta.departmentId);
  const sectionDeptId = departments.find((d) => d.name === ta.department)?.id;
  if (sectionDeptId) candidates.add(sectionDeptId);
  if (course && ta.year != null) {
    const inherited = inheritedAssignmentDepartmentId(course, ta.year, departments);
    if (inherited) candidates.add(inherited);
  }
  return candidates.has(instance.departmentId);
}

export class SubjectInstanceService {
  constructor(private db = getAdminDb()) {}

  /**
   * Removes an instance copy for a given subject, department and semester
   * (the same subject may have a separate live instance in another semester).
   */
  public async unassignSubjectInstance(collegeId: string, subjectId: string, departmentId: string, semester: number): Promise<void> {
    const collegeRef = this.db.collection("colleges").doc(collegeId);

    // Guard: never remove a semester instance a live teaching assignment
    // still relies on (its timetable slots and attendance hang off that
    // assignment). Previously queried `semester` + the instance's
    // departmentId, but section-scoped assignments store `timetableSemester`
    // and the section course's departmentId, so the guard never matched them.
    const [assignmentsSnap, instanceSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("teachingAssignments").where("subjectId", "==", subjectId).get(),
      collegeRef.collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}_${semester}`).get(),
      collegeRef.collection("departments").get(),
    ]);
    const live = assignmentsSnap.docs.map((d) => d.data() as TeachingAssignment).filter((a) => !a.isPast);
    if (live.length > 0) {
      const departments = deptsSnap.docs.map((d) => ({ ...(d.data() as Department), id: d.id }));
      const courseIds = Array.from(new Set(live.map((a) => a.courseId).filter((c): c is string => !!c)));
      const courseSnaps = courseIds.length > 0 ? await this.db.getAll(...courseIds.map((c) => collegeRef.collection("courses").doc(c))) : [];
      const coursesById = new Map(courseSnaps.filter((c) => c.exists).map((c) => [c.id, c.data() as Course]));
      const instanceYear = instanceSnap.exists ? (instanceSnap.data() as { year?: number }).year : undefined;
      if (live.some((a) => teachingAssignmentUsesInstance(a, { departmentId, semester, year: instanceYear }, departments, coursesById))) {
        throw new Error("This subject has active faculty teaching assignments in this semester. Please remove or reassign faculty before unassigning.");
      }
    }

    const instanceDocId = `${subjectId}_${departmentId}_${semester}`;
    // A pre-migration instance for this exact subject+department+semester
    // may still sit under the old (semester-less) key - delete it too, or
    // it survives this Remove and reappears as the "same" subject on the
    // next load. A legacy doc for a DIFFERENT semester is left alone (still
    // a live, distinct instance - see assignSubjectInstance's own comment).
    const legacyRef = collegeRef.collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}`);
    const legacy = await legacyRef.get();
    const deletes = [collegeRef.collection("subjectSemesterAssignments").doc(instanceDocId).delete()];
    if (legacy.exists && (legacy.data() as { semester?: number }).semester === semester) {
      deletes.push(legacyRef.delete());
    }
    await Promise.all(deletes);
  }
}
