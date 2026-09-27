import { getAdminDb } from "@/lib/firebase/admin";
import type { Subject, SubjectSemesterAssignment } from "@/types";

export interface SubjectInstanceAssignOptions {
  collegeId: string;
  subjectId: string;
  departmentId: string;
  semester: number;
  departmentName?: string;
  year?: number;
  customOverrides?: {
    lectureHours?: number;
    tutorialHours?: number;
    practicalHours?: number;
    credits?: number;
  };
}

export interface BulkAssignOptions {
  collegeId: string;
  subjectIds: string[];
  departmentId: string;
  semester: number;
  departmentName?: string;
  year?: number;
}

export interface BulkAssignResult {
  assignedCount: number;
  failed: { subjectId: string; error: string }[];
}

export class SubjectInstanceService {
  constructor(private db = getAdminDb()) {}

  /**
   * Resolves the ordinal Year (1..6) configured for the given course and semester
   */
  public async resolveYearForSemester(
    collegeId: string,
    courseId: string,
    semester: number
  ): Promise<number | null> {
    const collegeRef = this.db.collection("colleges").doc(collegeId);
    for (let y = 1; y <= 6; y++) {
      const snap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${y}`).get();
      if (snap.exists) {
        const sems = (snap.data() as { semesters?: { semester: number }[] })?.semesters ?? [];
        if (sems.some((s) => s.semester === semester)) {
          return y;
        }
      }
    }
    return null;
  }

  /**
   * Instantiates and copies a Master Subject into a Department-Course-Year-Semester Instance.
   */
  public async assignSubjectInstance(options: SubjectInstanceAssignOptions): Promise<{ id: string; instance: SubjectSemesterAssignment }> {
    const { collegeId, subjectId, departmentId, semester, departmentName, customOverrides } = options;
    const collegeRef = this.db.collection("colleges").doc(collegeId);

    // 1. Fetch Master Subject
    const masterDoc = await collegeRef.collection("subjects").doc(subjectId).get();
    if (!masterDoc.exists) {
      throw new Error(`Master subject with ID "${subjectId}" was not found`);
    }
    const master = masterDoc.data() as Subject;
    const courseId = master.courseId;
    if (!courseId) {
      throw new Error("Master subject has no courseId associated with it");
    }

    // 2. Fetch Department (name + courseScopes, for the scope check below)
    // and the Course (its catalogId keys into Department.courseScopes).
    const [deptDoc, courseDoc] = await Promise.all([
      collegeRef.collection("departments").doc(departmentId).get(),
      collegeRef.collection("courses").doc(courseId).get(),
    ]);
    if (!deptDoc.exists) {
      throw new Error("Department not found");
    }
    const deptData = deptDoc.data() as { name?: string; courseScopes?: Record<string, { assignedYears?: number[] }>; assignedYears?: number[] };
    const resolvedDeptName = departmentName ?? deptData.name;
    const catalogId = (courseDoc.data() as { catalogId?: string } | undefined)?.catalogId;

    // 3. Resolve ordinal year from Course-Year Timings - the authoritative
    // mapping of which year a semester actually belongs to. A client-supplied
    // `year` is cross-checked against it rather than trusted outright: this
    // used to accept whatever `year` the caller sent whenever one was
    // present, skipping this resolution (and its "is this semester even
    // configured" check) entirely - a year/semester mismatch could be stored
    // with no server-side check at all.
    const foundYear = await this.resolveYearForSemester(collegeId, courseId, semester);
    if (foundYear == null) {
      throw new Error(
        `Semester ${semester} isn't configured in Course-Year Timings for course "${master.courseName || courseId}".`
      );
    }
    if (options.year != null && options.year !== foundYear) {
      throw new Error(
        `Semester ${semester} belongs to Year ${foundYear} for this course, not Year ${options.year} - check Course-Year Timings.`
      );
    }
    const resolvedYear = foundYear;

    // 4. This department must actually be scoped to teach this course in
    // this year (Department.courseScopes, or the legacy flat assignedYears
    // fallback when no per-course override exists) - otherwise nothing stops
    // a wrong-department pick (any role) from silently creating a mapping
    // for a course/year the department doesn't run at all.
    const scopedYears = (catalogId ? deptData.courseScopes?.[catalogId]?.assignedYears : undefined) ?? deptData.assignedYears;
    if (scopedYears && scopedYears.length > 0 && !scopedYears.includes(resolvedYear)) {
      throw new Error(
        `"${resolvedDeptName ?? departmentId}" isn't scoped to teach this course in Year ${resolvedYear} - check its Years Taught / Academic Structure.`
      );
    }

    // 5. Compute hours & credits (allowing department overrides if provided)
    const lectureHours = customOverrides?.lectureHours ?? master.lectureHours ?? 0;
    const tutorialHours = customOverrides?.tutorialHours ?? master.tutorialHours ?? 0;
    const practicalHours = customOverrides?.practicalHours ?? master.practicalHours ?? 0;
    const hoursPerWeek = lectureHours + tutorialHours + practicalHours;
    const credits = customOverrides?.credits ?? master.credits ?? 0;

    const instanceDocId = `${subjectId}_${departmentId}`;
    const instanceRef = collegeRef.collection("subjectSemesterAssignments").doc(instanceDocId);
    const existing = await instanceRef.get();
    const now = new Date();

    const instancePayload: SubjectSemesterAssignment = {
      id: instanceDocId,
      collegeId,
      subjectId,
      masterSubjectId: subjectId,
      subjectName: master.name ?? "",
      subjectCode: master.code ?? "",
      ...(master.shortCode ? { shortCode: master.shortCode } : {}),
      courseId,
      courseName: master.courseName ?? "",
      academicYear: master.academicYear ?? "",
      regulation: master.regulation ?? "",
      year: resolvedYear,
      departmentId,
      departmentName: resolvedDeptName ?? master.courseName ?? "",
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
      isCustomized: !!customOverrides,
      isActive: true,
      createdAt: (existing.exists ? (existing.data() as { createdAt?: unknown }).createdAt : now) as any,
      updatedAt: now as any,
    };

    await instanceRef.set(instancePayload);

    return { id: instanceDocId, instance: instancePayload };
  }

  /**
   * Bulk assigns multiple master subjects to a department-semester
   */
  public async bulkAssignSubjectInstances(options: BulkAssignOptions): Promise<BulkAssignResult> {
    const { collegeId, subjectIds, departmentId, semester, departmentName, year } = options;
    const failed: { subjectId: string; error: string }[] = [];
    let assignedCount = 0;

    for (const sid of subjectIds) {
      try {
        await this.assignSubjectInstance({
          collegeId,
          subjectId: sid,
          departmentId,
          semester,
          departmentName,
          year,
        });
        assignedCount++;
      } catch (err) {
        failed.push({
          subjectId: sid,
          error: err instanceof Error ? err.message : "Assignment failed",
        });
      }
    }

    return { assignedCount, failed };
  }

  /**
   * Removes an instance copy for a given subject and department
   */
  public async unassignSubjectInstance(collegeId: string, subjectId: string, departmentId: string): Promise<void> {
    const instanceDocId = `${subjectId}_${departmentId}`;
    await this.db
      .collection("colleges")
      .doc(collegeId)
      .collection("subjectSemesterAssignments")
      .doc(instanceDocId)
      .delete();
  }
}
