import { getAdminDb } from "@/lib/firebase/admin";
import type { Subject, SubjectSemesterAssignment } from "@/types";

export interface SubjectInstanceAssignOptions {
  collegeId: string;
  subjectId: string;
  departmentId: string;
  semester: number;
  departmentName?: string;
  year?: number;
  // The DEPARTMENT PERFORMING this assignment's own Course doc id - not
  // necessarily the same Course doc the master subject's own `courseId`
  // field points to (see assignSubjectInstance's own doc-comment on why
  // those can differ). Optional only for backward compatibility with any
  // caller that predates this field; falls back to the master subject's
  // own courseId when absent.
  courseId?: string;
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
  courseId?: string;
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
   *
   * `yearCache`, when passed, is consulted before re-walking courseYearTimings
   * 1..6 - callers within one bulk operation (bulkAssignSubjectInstances)
   * share a single Map across every subject, since courseId+semester is
   * normally identical for the whole call (subjects are pre-filtered to one
   * course by every caller today) and would otherwise re-read the same
   * courseYearTimings docs once per subject for no reason. Omitted by a
   * single-subject caller, which keeps resolving fresh every time as before.
   */
  public async assignSubjectInstance(
    options: SubjectInstanceAssignOptions,
    yearCache?: Map<string, number | null>
  ): Promise<{ id: string; instance: SubjectSemesterAssignment }> {
    const { collegeId, subjectId, departmentId, semester, departmentName, customOverrides } = options;
    const collegeRef = this.db.collection("colleges").doc(collegeId);

    // 1. Fetch Master Subject
    const masterDoc = await collegeRef.collection("subjects").doc(subjectId).get();
    if (!masterDoc.exists) {
      throw new Error(`Master subject with ID "${subjectId}" was not found`);
    }
    const master = masterDoc.data() as Subject;
    // The department PERFORMING this assignment's own Course doc id, not
    // master.courseId - a master subject is department-independent (visible
    // to every department teaching this catalog course, see
    // /api/college/subjects GET's own doc-comment), but its `courseId`
    // field still points to whichever ONE department's Course doc happened
    // to receive it when it was created. Resolving Year (step 3, via that
    // course's own courseYearTimings) and the department-scope check (step
    // 4) against that arbitrary origin department - instead of the
    // department this assignment is actually FOR - validated against the
    // wrong department's calendar entirely, and would have stored the
    // wrong courseId on the instance doc (silently invisible afterward,
    // since GET here filters by the requesting department's own courseId).
    // Falls back to master.courseId only for a caller that predates this
    // option (none currently exist - this file's own route.ts always sends
    // it now).
    const courseId = options.courseId || master.courseId;
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
    const deptData = deptDoc.data() as {
      name?: string;
      courseScopes?: Record<string, { assignedYears?: number[] }>;
      assignedYears?: number[];
      parentDepartmentId?: string;
    };
    const resolvedDeptName = departmentName ?? deptData.name;
    const catalogId = (courseDoc.data() as { catalogId?: string } | undefined)?.catalogId;

    // 3. Resolve ordinal year from Course-Year Timings - the authoritative
    // mapping of which year a semester actually belongs to. A client-supplied
    // `year` is cross-checked against it rather than trusted outright: this
    // used to accept whatever `year` the caller sent whenever one was
    // present, skipping this resolution (and its "is this semester even
    // configured" check) entirely - a year/semester mismatch could be stored
    // with no server-side check at all.
    const yearCacheKey = `${courseId}:${semester}`;
    let foundYear: number | null;
    if (yearCache?.has(yearCacheKey)) {
      foundYear = yearCache.get(yearCacheKey)!;
    } else {
      foundYear = await this.resolveYearForSemester(collegeId, courseId, semester);
      yearCache?.set(yearCacheKey, foundYear);
    }
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
    // fallback when no per-course override exists). If this is a sub-department
    // without its own assignedYears, inherit from the parent department.
    let scopedYears = (catalogId ? deptData.courseScopes?.[catalogId]?.assignedYears : undefined) ?? deptData.assignedYears;
    if ((!scopedYears || scopedYears.length === 0) && deptData.parentDepartmentId) {
      const parentDoc = await collegeRef.collection("departments").doc(deptData.parentDepartmentId).get();
      if (parentDoc.exists) {
        const parentData = parentDoc.data() as { courseScopes?: Record<string, { assignedYears?: number[] }>; assignedYears?: number[] };
        scopedYears = (catalogId ? parentData.courseScopes?.[catalogId]?.assignedYears : undefined) ?? parentData.assignedYears;
      }
    }
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
    const { collegeId, subjectIds, departmentId, semester, departmentName, year, courseId } = options;
    const failed: { subjectId: string; error: string }[] = [];
    let assignedCount = 0;
    // Shared across every subject in this call - every one of them normally
    // resolves to the same courseId+semester (they're pre-filtered to one
    // course by every caller), so this turns what used to be up to 6
    // sequential Firestore reads PER SUBJECT (courseYearTimings 1..6) into
    // one lookup total for the whole bulk call.
    const yearCache = new Map<string, number | null>();

    for (const sid of subjectIds) {
      try {
        await this.assignSubjectInstance({
          collegeId,
          subjectId: sid,
          departmentId,
          semester,
          departmentName,
          year,
          courseId,
        }, yearCache);
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
