import { getAdminDb } from "@/lib/firebase/admin";
import { inheritedAssignmentDepartmentId } from "@/lib/timetable/sharedYearTiming";
import { notConfiguredMessage } from "@/lib/college/taughtYears";
import { MAX_COURSE_DURATION_YEARS } from "@/lib/college/courseYears";
import type { Course, Department, Subject, SubjectSemesterAssignment, TeachingAssignment } from "@/types";

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

/**
 * The exact SubjectSemesterAssignment document a master subject becomes
 * once placed into one department's course-year-semester. Shared by
 * assignSubjectInstance (one subject at a time) and
 * CourseStructureImportService (a whole file inside one transaction), so an
 * instance written by either path is field-for-field the same shape every
 * downstream reader (Teaching Assignments, HOD Subjects, sections) expects.
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
    customOverrides?: SubjectInstanceAssignOptions["customOverrides"];
    createdAt: unknown;
    now: Date;
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
    isCustomized: !!customOverrides,
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
   * Resolves the ordinal Year configured for the given course and semester - scanning the course's
   * OWN years (1..its durationYears), not a fixed span. `durationYears` is passed by callers that
   * already hold the Course doc; otherwise it is read here, and only if the course can't be read is
   * the catalog's own ceiling (MAX_COURSE_DURATION_YEARS) used.
   * When `yearHint` is provided, checks that year first to support relative semester numbering
   * (e.g. Semesters 1 & 2 in Year 1 as well as Semesters 1 & 2 in Year 2).
   */
  public async resolveYearForSemester(
    collegeId: string,
    courseId: string,
    semester: number,
    yearHint?: number,
    durationYears?: number
  ): Promise<number | null> {
    const collegeRef = this.db.collection("colleges").doc(collegeId);
    let lastYear = Number(durationYears);
    if (!Number.isInteger(lastYear) || lastYear < 1) {
      const courseSnap = await collegeRef.collection("courses").doc(courseId).get();
      const stored = Number((courseSnap.data() as { durationYears?: number } | undefined)?.durationYears);
      lastYear = Number.isInteger(stored) && stored >= 1 ? stored : MAX_COURSE_DURATION_YEARS;
    }

    // 1. If a yearHint is given, check that year's timing doc first
    if (yearHint != null && yearHint >= 1 && yearHint <= lastYear) {
      const snap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${yearHint}`).get();
      if (snap.exists) {
        const sems = (snap.data() as { semesters?: { semester: number }[] })?.semesters ?? [];
        if (sems.some((s) => s.semester === semester)) {
          return yearHint;
        }
      }
    }

    // 2. Scan the course's remaining years
    for (let y = 1; y <= lastYear; y++) {
      if (y === yearHint) continue;
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
    const yearCacheKey = `${courseId}:${options.year ?? ""}:${semester}`;
    let foundYear: number | null;
    if (yearCache?.has(yearCacheKey)) {
      foundYear = yearCache.get(yearCacheKey)!;
    } else {
      foundYear = await this.resolveYearForSemester(
        collegeId, courseId, semester, options.year,
        (courseDoc.data() as { durationYears?: number } | undefined)?.durationYears
      );
      yearCache?.set(yearCacheKey, foundYear);
    }

    let resolvedYear: number;
    if (foundYear != null) {
      if (options.year != null && options.year !== foundYear) {
        throw new Error(
          `Semester ${semester} belongs to Year ${foundYear} for this course, not Year ${options.year} - check Course-Year Timings.`
        );
      }
      resolvedYear = foundYear;
    } else {
      // If timing docs have not been created yet or define no semesters, but options.year was explicitly provided
      const courseLastYear = Number((courseDoc.data() as { durationYears?: number } | undefined)?.durationYears);
      if (options.year != null && options.year >= 1 && options.year <= (courseLastYear >= 1 ? courseLastYear : MAX_COURSE_DURATION_YEARS)) {
        resolvedYear = options.year;
      } else {
        throw new Error(
          `Semester ${semester} isn't configured in Course-Year Timings for course "${master.courseName || courseId}".`
        );
      }
    }

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
    // An EMPTY list is "not configured", never "teaches everything" (lib/college/taughtYears.ts).
    if (!scopedYears || scopedYears.length === 0) {
      throw new Error(notConfiguredMessage(resolvedDeptName ?? departmentId, resolvedYear, master.courseName || undefined));
    }
    if (!scopedYears.includes(resolvedYear)) {
      throw new Error(
        `"${resolvedDeptName ?? departmentId}" isn't scoped to teach this course in Year ${resolvedYear} - check its Years Taught / Academic Structure.`
      );
    }

    // Keyed by semester too (not just subject+department) so the same
    // subject can be a live instance in two different semesters for one
    // department at once (a year-long / shared subject spanning S1+S2) -
    // collapsing them onto one doc silently moved the subject to whichever
    // semester was assigned most recently instead of holding both.
    const instanceDocId = `${subjectId}_${departmentId}_${semester}`;
    const instanceRef = collegeRef.collection("subjectSemesterAssignments").doc(instanceDocId);
    // Pre-migration instances were keyed without the semester suffix (see
    // above) - reconciled below once the new-key doc is written, so a
    // subject assigned before this change doesn't linger as an
    // invisible-by-id duplicate that a later Add re-creates under the new
    // key, or that Remove (which only knows the new key) can't reach.
    const legacyRef = collegeRef.collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}`);
    const [existing, legacy] = await Promise.all([instanceRef.get(), legacyRef.get()]);
    const now = new Date();

    const instancePayload = buildSubjectInstancePayload(master, {
      collegeId,
      subjectId,
      courseId,
      departmentId,
      departmentName: resolvedDeptName,
      year: resolvedYear,
      semester,
      customOverrides,
      createdAt: existing.exists
        ? (existing.data() as { createdAt?: unknown }).createdAt
        : legacy.exists && (legacy.data() as { semester?: number }).semester === semester
          ? (legacy.data() as { createdAt?: unknown }).createdAt
          : now,
      now,
    });

    await instanceRef.set(instancePayload);
    // Only the legacy doc for THIS semester is superseded - one made under
    // the old key for a different semester is still a live, distinct
    // instance (that's the whole reason the key gained a semester suffix)
    // and must be left alone.
    if (legacy.exists && !existing.exists && (legacy.data() as { semester?: number }).semester === semester) {
      await legacyRef.delete();
    }

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
