import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentRunsOwnSections } from "@/lib/college/academicStructure";
import { currentAcademicStartYear, regulationsForCourseYearByBatch } from "@/lib/college/academicSession";
import { teachableYearsForDepartment } from "@/lib/subjects/teachableYears";
import { findBranchManager, managerTeachingYears } from "@/lib/departments/managedBranches";
import {
  subjectIdentityKey,
  validateCourseStructureRows,
  type CourseStructureIssue,
  type CourseStructureRow,
  type CourseStructureRowInput,
  type CourseStructureScope,
} from "@/lib/subjects/courseStructureValidation";
import type { CategoryDefinition } from "@/lib/subjects/categoryDefinitions";
import { buildSubjectInstancePayload } from "./SubjectInstanceService";
import type { Course, CourseYearTiming, Department, Subject, SubjectSemesterAssignment } from "@/types";

// Academics > Course Structure: one file of subjects for one
// Regulation + Course + Department, fanned out into master subjects
// (colleges/{id}/subjects) and per-semester instances
// (colleges/{id}/subjectSemesterAssignments) - the records Teaching
// Assignments, HOD Subjects and sections all read.
//
// All-or-nothing, in two calls:
//  - validate: re-derives the department's scope from Firestore, runs the
//    shared row rulebook (courseStructureValidation.ts), resolves every
//    row against existing masters/instances, and returns the plan. Writes
//    nothing.
//  - commit: the same, then ONE transaction that re-reads the configuration
//    it depends on (timings, department years, catalog regulations,
//    existing masters/instances), aborts if anything drifted, and only then
//    writes every master + instance together. Afterwards each written
//    instance is read back and its links (regulation, course, department,
//    year, semester, master) are checked.
//
// Replaces the previous create-masters-then-assign-row-by-row loop, which
// committed masters before scope checks ran and could leave orphan masters
// plus a half-assigned file.

export type CourseStructureMode = "validate" | "commit";

export interface CourseStructureRequest {
  collegeId: string;
  courseId: string;
  departmentId: string;
  regulation: string;
  records: CourseStructureRowInput[];
}

export interface CourseStructureScopeSummary {
  course: { id: string; name: string; catalogId?: string; departmentId: string };
  department: { id: string; name: string; parentDepartmentId?: string };
  regulation: string;
  scope: CourseStructureScope;
  // Which regulation(s) govern each year for the batch currently in it -
  // what the Academics Teaching Assignments year picker filters by.
  regulationCoverage: { year: number; regulations: string[] }[];
  // Subjects already assigned to this department for this course, per slot.
  existing: { year: number; semester: number; count: number; regulations: string[]; subjects: CourseStructureAssignedSubject[] }[];
}

export interface CourseStructureAssignedSubject {
  subjectId: string;
  code: string;
  name: string;
  regulation: string;
  category?: string;
  type?: string;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  credits: number;
}

export interface CourseStructurePlanRow {
  row: number;
  code: string;
  key: string;
  name: string;
  year: number;
  semester: number;
  master: "create" | "reuse";
  instance: "create" | "unchanged" | "reactivate";
}

export interface CourseStructureResult {
  ok: boolean;
  mode: CourseStructureMode;
  errors: CourseStructureIssue[];
  warnings: CourseStructureIssue[];
  summary?: CourseStructureScopeSummary;
  plan: CourseStructurePlanRow[];
  counts: { rows: number; mastersCreated: number; mastersReused: number; instancesWritten: number; unchanged: number };
  verification?: { checked: number; problems: string[] };
}

// A request that can't even be evaluated (bad course/department/regulation) -
// surfaced by the route as a 400, not a per-row result.
export class CourseStructureRequestError extends Error {}
// Configuration changed between validation and commit - route returns 409.
export class CourseStructureConflictError extends Error {}

// Firestore's per-commit ceiling, per this repo's convention (CLAUDE.md).
const MAX_WRITES_PER_COMMIT = 500;

type Dept = Department & { id: string };
type CourseDoc = Course & { id: string };
type MasterDoc = Subject & { id: string };

interface LoadedContext {
  // Every Course doc sharing this course's catalog entry - the dedupe group
  // for master subjects. Read once in loadContext.
  groupCourseIds: string[];
  course: CourseDoc;
  department: Dept;
  allDepartments: Dept[];
  catalog: { regulations: string[]; regulationBatches: Record<string, string> } | null;
  timings: Record<number, number[]>;
  summary: CourseStructureScopeSummary;
}

interface Plan {
  errors: CourseStructureIssue[];
  warnings: CourseStructureIssue[];
  rows: CourseStructureRow[];
  planRows: CourseStructurePlanRow[];
  // code -> master id (existing or deterministic new)
  masterIdByCode: Map<string, string>;
  newMasterCodes: Set<string>;
  existingInstanceIds: Set<string>;
  legacyToDelete: Map<string, { createdAt: unknown }>;
  writes: number;
}

function semestersFrom(timing: Partial<CourseYearTiming> | undefined): number[] {
  return (timing?.semesters ?? []).map((s) => Number(s.semester)).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

/**
 * Null when `course` is the Course doc `department` actually runs for its
 * catalog entry, otherwise the reason it isn't: the department's own Course
 * doc when it has one, else the one it inherits (its parent's, for a
 * sub-department) or is fed from (a department listing it in
 * secondaryDepartments) - the same set /api/college/courses?departmentId=
 * offers the page's picker, so Teaching Assignments later resolves the
 * same courseId. Also rejects a "no own sections" parent, which can never
 * hold a section to teach these subjects in.
 */
export function courseOwnershipError(
  course: Pick<Course, "name" | "departmentId"> & { id: string },
  department: Dept,
  allDepartments: Dept[],
  sameCatalogCourses: (Pick<Course, "departmentId" | "isActive"> & { id: string })[]
): string | null {
  const ownDocs = sameCatalogCourses.filter((c) => c.departmentId === department.id && c.isActive !== false);
  const related = new Set<string>([department.id]);
  if (department.parentDepartmentId) related.add(department.parentDepartmentId);
  else for (const d of allDepartments) if ((d.secondaryDepartments ?? []).includes(department.name)) related.add(d.id);
  const belongs = ownDocs.length > 0 ? ownDocs.some((c) => c.id === course.id) : related.has(course.departmentId);
  if (!belongs) {
    return ownDocs.length > 0
      ? `${department.name} has its own copy of ${course.name}. Select it again so subjects attach to that copy.`
      : `${course.name} isn't run by ${department.name}.`;
  }
  if (!departmentRunsOwnSections(department)) {
    return `${department.name} doesn't run sections of its own. Import into one of its sub-departments instead.`;
  }
  return null;
}

function customCategoriesFrom(docs: FirebaseFirestore.DocumentData[]): CategoryDefinition[] {
  return docs
    .filter((d): d is CategoryDefinition => typeof d.code === "string" && typeof d.fullForm === "string")
    .map((d) => ({ code: d.code, fullForm: d.fullForm }));
}

export class CourseStructureImportService {
  constructor(private db = getAdminDb()) {}

  private collegeRef(collegeId: string) {
    return this.db.collection("colleges").doc(collegeId);
  }

  // ── Context: course, department, scope ──────────────────────────────────
  // Pure given the fetched docs, so the commit transaction can rebuild it
  // from its own (locked) reads and compare.
  private buildContext(
    courseId: string,
    departmentId: string,
    regulation: string,
    courseData: Course | undefined,
    deptDocs: Dept[],
    sameCatalogCourses: CourseDoc[],
    catalogData: { regulations?: string[]; regulationBatches?: Record<string, string> } | undefined,
    timingDocs: (Partial<CourseYearTiming> | undefined)[],
    customCategories: CategoryDefinition[] = []
  ): Omit<LoadedContext, "summary" | "groupCourseIds"> & { summary: Omit<CourseStructureScopeSummary, "existing"> } {
    if (!courseData) throw new CourseStructureRequestError("Course not found.");
    if (courseData.isActive === false) throw new CourseStructureRequestError("This course is inactive.");
    const course: CourseDoc = { ...courseData, id: courseId, durationYears: Number(courseData.durationYears) || 0 };
    const department = deptDocs.find((d) => d.id === departmentId);
    if (!department) throw new CourseStructureRequestError("Department not found.");

    const ownershipError = courseOwnershipError(course, department, deptDocs, sameCatalogCourses);
    if (ownershipError) throw new CourseStructureRequestError(ownershipError);

    const catalog = catalogData
      ? { regulations: catalogData.regulations ?? [], regulationBatches: catalogData.regulationBatches ?? {} }
      : null;
    if (!regulation) throw new CourseStructureRequestError("Select a regulation.");
    if (!catalog || catalog.regulations.length === 0) {
      throw new CourseStructureRequestError(`${course.name} has no regulations configured in the Course Catalog.`);
    }
    if (!catalog.regulations.includes(regulation)) {
      throw new CourseStructureRequestError(`Regulation ${regulation} isn't assigned to ${course.name} (available: ${catalog.regulations.join(", ")}).`);
    }

    const timings: Record<number, number[]> = {};
    timingDocs.forEach((t, i) => { timings[i + 1] = semestersFrom(t); });
    const teachableYears = teachableYearsForDepartment(course, department, deptDocs);
    const scope: CourseStructureScope = { durationYears: course.durationYears, teachableYears, semestersByYear: timings, customCategories };

    const startYear = currentAcademicStartYear();
    return {
      course,
      department,
      allDepartments: deptDocs,
      catalog,
      timings,
      summary: {
        course: { id: course.id, name: course.name, catalogId: course.catalogId, departmentId: course.departmentId },
        department: { id: department.id, name: department.name, parentDepartmentId: department.parentDepartmentId },
        regulation,
        scope,
        regulationCoverage: Array.from({ length: course.durationYears }, (_, i) => ({
          year: i + 1,
          regulations: regulationsForCourseYearByBatch(catalog.regulationBatches, i + 1, startYear, catalog.regulations),
        })),
      },
    };
  }

  private timingRefs(collegeId: string, courseId: string, durationYears: number) {
    const coll = this.collegeRef(collegeId).collection("courseYearTimings");
    return Array.from({ length: durationYears }, (_, i) => coll.doc(`${courseId}_year${i + 1}`));
  }

  async loadContext(collegeId: string, courseId: string, departmentId: string, regulation: string): Promise<LoadedContext & { existingInstances: SubjectSemesterAssignment[] }> {
    const college = this.collegeRef(collegeId);
    const [courseSnap, deptsSnap] = await Promise.all([
      college.collection("courses").doc(courseId).get(),
      college.collection("departments").get(),
    ]);
    const courseData = courseSnap.exists ? (courseSnap.data() as Course) : undefined;
    const deptDocs = deptsSnap.docs.map((d) => ({ ...(d.data() as Department), id: d.id }));
    const catalogId = courseData?.catalogId;
    const durationYears = Number(courseData?.durationYears) || 0;
    const [sameCatalogSnap, catalogSnap, timingSnaps, instancesSnap, categoriesSnap] = await Promise.all([
      catalogId ? college.collection("courses").where("catalogId", "==", catalogId).get() : Promise.resolve(null),
      catalogId ? college.collection("courseCatalog").doc(catalogId).get() : Promise.resolve(null),
      durationYears > 0 ? this.db.getAll(...this.timingRefs(collegeId, courseId, durationYears)) : Promise.resolve([]),
      college.collection("subjectSemesterAssignments").where("courseId", "==", courseId).get(),
      college.collection("subjectCategories").get(),
    ]);
    const sameCatalog = sameCatalogSnap
      ? sameCatalogSnap.docs.map((d) => ({ ...(d.data() as Course), id: d.id }))
      : courseData ? [{ ...courseData, id: courseId }] : [];
    const ctx = this.buildContext(
      courseId, departmentId, regulation, courseData, deptDocs, sameCatalog,
      catalogSnap?.exists ? (catalogSnap.data() as { regulations?: string[]; regulationBatches?: Record<string, string> }) : undefined,
      timingSnaps.map((s) => (s.exists ? (s.data() as Partial<CourseYearTiming>) : undefined)),
      customCategoriesFrom(categoriesSnap.docs.map((d) => d.data()))
    );
    const existingInstances = instancesSnap.docs
      .map((d) => ({ ...(d.data() as SubjectSemesterAssignment), id: d.id }))
      .filter((a) => a.departmentId === departmentId && a.isActive !== false);
    const slots = new Map<string, { year: number; semester: number; regulations: Set<string>; subjects: CourseStructureAssignedSubject[] }>();
    for (const a of existingInstances) {
      const key = `${a.year ?? 0}|${a.semester}`;
      const slot = slots.get(key) ?? { year: a.year ?? 0, semester: a.semester, regulations: new Set<string>(), subjects: [] };
      if (a.regulation) slot.regulations.add(a.regulation);
      slot.subjects.push({
        subjectId: a.subjectId,
        code: a.subjectCode ?? "",
        name: a.subjectName ?? "",
        regulation: a.regulation ?? "",
        category: a.category,
        type: a.type,
        lectureHours: a.lectureHours ?? 0,
        tutorialHours: a.tutorialHours ?? 0,
        practicalHours: a.practicalHours ?? 0,
        credits: a.credits ?? 0,
      });
      slots.set(key, slot);
    }
    return {
      ...ctx,
      groupCourseIds: sameCatalog.map((c) => c.id).includes(courseId) ? sameCatalog.map((c) => c.id) : [courseId, ...sameCatalog.map((c) => c.id)],
      existingInstances,
      summary: {
        ...ctx.summary,
        existing: Array.from(slots.values())
          .map((s) => ({
            year: s.year,
            semester: s.semester,
            count: s.subjects.length,
            regulations: Array.from(s.regulations).sort(),
            subjects: s.subjects.sort((x, y) => x.code.localeCompare(y.code)),
          }))
          .sort((a, b) => a.year - b.year || a.semester - b.semester),
      },
    };
  }

  // Master subjects are shared by every department running the same catalog
  // course, deduped by catalog + regulation + subject identity (code, name,
  // category, L-T-P - see subjectIdentityKey), so one code may name several
  // different subjects. A new master's id is derived from exactly
  // that key, so two concurrent imports of the same subject collide on one
  // document (tx.create fails) instead of creating twin masters.
  private newMasterId(collegeId: string, groupKey: string, regulation: string, key: string): string {
    return "cs_" + createHash("sha256").update(`${collegeId}|${groupKey}|${regulation}|${key}`).digest("hex").slice(0, 24);
  }

  private async loadExistingMasters(collegeId: string, ctx: LoadedContext, regulation: string): Promise<Map<string, MasterDoc>> {
    const college = this.collegeRef(collegeId);
    const ids = ctx.groupCourseIds;
    const byCode = new Map<string, MasterDoc>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map((chunk) => college.collection("subjects").where("courseId", "in", chunk).get()));
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const s = { ...(d.data() as Subject), id: d.id };
        if ((s.regulation ?? "").trim() !== regulation || !s.code) continue;
        const key = subjectIdentityKey({
          code: s.code.toUpperCase(), name: s.name ?? "", category: s.category ?? "",
          lectureHours: s.lectureHours ?? 0, tutorialHours: s.tutorialHours ?? 0, practicalHours: s.practicalHours ?? 0,
        });
        const prev = byCode.get(key);
        // Prefer this department's own course's master if legacy duplicates exist.
        if (!prev || (prev.courseId !== ctx.course.id && s.courseId === ctx.course.id)) byCode.set(key, s);
      }
    }
    return byCode;
  }

  private async buildPlan(
    req: CourseStructureRequest,
    ctx: LoadedContext & { existingInstances: SubjectSemesterAssignment[] }
  ): Promise<Plan> {
    const validation = validateCourseStructureRows(req.records, ctx.summary.scope);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const plan: Plan = {
      errors, warnings, rows: validation.rows, planRows: [],
      masterIdByCode: new Map(), newMasterCodes: new Set(), existingInstanceIds: new Set(),
      legacyToDelete: new Map(), writes: 0,
    };
    if (validation.rows.length === 0) return plan;

    const existingMasters = await this.loadExistingMasters(req.collegeId, ctx, req.regulation);
    const groupKey = ctx.course.catalogId || ctx.course.id;
    const instancesById = new Map(ctx.existingInstances.map((a) => [a.id, a]));

    for (const row of validation.rows) {
      const key = subjectIdentityKey(row);
      let masterId = plan.masterIdByCode.get(key);
      let masterAction: CourseStructurePlanRow["master"] = "reuse";
      if (!masterId) {
        const existing = existingMasters.get(key);
        if (existing) {
          if (existing.isActive === false) {
            errors.push({ row: row.rowNumber, field: "code", message: `Subject ${row.code} exists for ${req.regulation} but is deactivated. Reactivate it or use a different code.` });
            continue;
          }
          masterId = existing.id;
        } else {
          masterId = this.newMasterId(req.collegeId, groupKey, req.regulation, key);
          plan.newMasterCodes.add(key);
        }
        plan.masterIdByCode.set(key, masterId);
      }
      if (plan.newMasterCodes.has(key)) masterAction = "create";

      // Instance for this department + semester.
      const instanceId = `${masterId}_${ctx.department.id}_${row.semester}`;
      const current = instancesById.get(instanceId);
      let instanceAction: CourseStructurePlanRow["instance"] = "create";
      if (current) {
        if (current.year != null && current.year !== row.year) {
          errors.push({ row: row.rowNumber, field: "year", message: `${row.code} is already assigned to Year ${current.year} Semester ${row.semester} for this department.` });
          continue;
        }
        instanceAction = "unchanged";
        plan.existingInstanceIds.add(instanceId);
      }
      plan.planRows.push({ row: row.rowNumber, code: row.code, key, name: row.name, year: row.year, semester: row.semester, master: masterAction, instance: instanceAction });
    }

    // A reused subject may still have a pre-migration instance under the old
    // semester-less key - carried over and removed, same as
    // SubjectInstanceService.assignSubjectInstance. One batched read for all.
    const legacyCandidates = plan.planRows.filter((p) => p.master === "reuse" && p.instance === "create");
    if (legacyCandidates.length > 0) {
      const instances = this.collegeRef(req.collegeId).collection("subjectSemesterAssignments");
      const legacySnaps = await this.db.getAll(...legacyCandidates.map((p) => instances.doc(`${plan.masterIdByCode.get(p.key)}_${ctx.department.id}`)));
      legacyCandidates.forEach((p, i) => {
        const legacy = legacySnaps[i].exists ? (legacySnaps[i].data() as { semester?: number; createdAt?: unknown }) : null;
        if (legacy && legacy.semester === p.semester) {
          plan.legacyToDelete.set(`${plan.masterIdByCode.get(p.key)}_${ctx.department.id}_${p.semester}`, { createdAt: legacy.createdAt });
          p.instance = "reactivate";
        }
      });
    }

    // Slots that already hold subjects under a DIFFERENT regulation: Teaching
    // Assignments lists every subject in a course-year-semester regardless of
    // regulation, so both sets would show side by side.
    const fileSlots = new Set(validation.rows.map((r) => `${r.year}|${r.semester}`));
    for (const slot of ctx.summary.existing) {
      const others = slot.regulations.filter((r) => r !== req.regulation);
      if (fileSlots.has(`${slot.year}|${slot.semester}`) && others.length > 0) {
        warnings.push({ row: 0, message: `Year ${slot.year} Semester ${slot.semester} already has subjects under ${others.join(", ")}. Teaching Assignments will list them alongside these ${req.regulation} subjects. Remove the old ones if they're no longer taught.` });
      }
    }
    // Years this regulation doesn't currently govern.
    for (const year of Array.from(new Set(validation.rows.map((r) => r.year))).sort()) {
      const cov = ctx.summary.regulationCoverage.find((c) => c.year === year);
      if (cov && cov.regulations.length > 0 && !cov.regulations.includes(req.regulation)) {
        warnings.push({ row: 0, message: `Year ${year} is currently taught under ${cov.regulations.join(", ")}, not ${req.regulation}. These subjects will be ready for when a ${req.regulation} batch reaches Year ${year}.` });
      }
    }

    // Calculate writes including fan-out to managed branches.
    // Manager's own assignments + copies for each managed branch.
    const managedBranches = ctx.allDepartments.find((d) => d.id === ctx.department.id)?.managedDepartments ?? [];
    const branchWriteMultiplier = 1 + managedBranches.length;
    plan.writes = plan.newMasterCodes.size
      + (plan.planRows.filter((p) => p.instance !== "unchanged").length * branchWriteMultiplier)
      + plan.legacyToDelete.size;
    if (plan.writes > MAX_WRITES_PER_COMMIT) {
      errors.push({ row: 0, message: `This file needs ${plan.writes} writes (${plan.planRows.length} rows × ${branchWriteMultiplier} branches), more than one atomic import allows (${MAX_WRITES_PER_COMMIT}). Split it by year or reduce branches.` });
    }
    errors.sort((a, b) => a.row - b.row);
    return plan;
  }

  private masterPayload(req: CourseStructureRequest, ctx: LoadedContext, row: CourseStructureRow, now: Date): Omit<Subject, "id"> {
    return {
      collegeId: req.collegeId,
      courseId: ctx.course.id,
      courseName: ctx.course.name,
      regulation: req.regulation,
      serialNumber: row.rowNumber - 1,
      category: row.category,
      ...(row.customCategory ? { customCategory: row.customCategory } : {}),
      name: row.name,
      code: row.code,
      ...(row.shortCode ? { shortCode: row.shortCode } : {}),
      hoursPerWeek: row.hoursPerWeek,
      lectureHours: row.lectureHours,
      tutorialHours: row.tutorialHours,
      practicalHours: row.practicalHours,
      credits: row.credits,
      type: row.type,
      ...(row.internalMarks != null ? { internalMarks: row.internalMarks } : {}),
      ...(row.externalMarks != null ? { externalMarks: row.externalMarks } : {}),
      ...(row.totalMarks != null ? { totalMarks: row.totalMarks } : {}),
      isActive: true,
      createdAt: now as unknown as Subject["createdAt"],
      updatedAt: now as unknown as Subject["updatedAt"],
    };
  }

  async getScope(collegeId: string, courseId: string, departmentId: string, regulation: string): Promise<CourseStructureScopeSummary> {
    return (await this.loadContext(collegeId, courseId, departmentId, regulation)).summary;
  }

  async run(req: CourseStructureRequest, mode: CourseStructureMode): Promise<CourseStructureResult> {
    const ctx = await this.loadContext(req.collegeId, req.courseId, req.departmentId, req.regulation);
    const plan = await this.buildPlan(req, ctx);
    const counts = {
      rows: req.records.length,
      mastersCreated: plan.newMasterCodes.size,
      mastersReused: new Set(plan.planRows.filter((p) => p.master === "reuse").map((p) => p.key)).size,
      instancesWritten: plan.planRows.filter((p) => p.instance !== "unchanged").length,
      unchanged: plan.planRows.filter((p) => p.instance === "unchanged").length,
    };
    const base = { mode, errors: plan.errors, warnings: plan.warnings, summary: ctx.summary, plan: plan.planRows, counts };
    if (plan.errors.length > 0 || mode === "validate") return { ok: plan.errors.length === 0, ...base };

    await this.commit(req, ctx, plan);
    const verification = await this.verify(req, ctx, plan);
    return { ok: true, ...base, verification };
  }

  private async commit(req: CourseStructureRequest, ctx: LoadedContext, plan: Plan): Promise<void> {
    const college = this.collegeRef(req.collegeId);
    const instances = college.collection("subjectSemesterAssignments");
    const subjects = college.collection("subjects");
    const rowByCode = new Map<string, CourseStructureRow>();
    for (const r of plan.rows) { const k = subjectIdentityKey(r); if (!rowByCode.has(k)) rowByCode.set(k, r); }
    const toWrite = plan.planRows.filter((p) => p.instance !== "unchanged");
    const reusedMasterIds = Array.from(new Set(
      plan.planRows.filter((p) => p.master === "reuse").map((p) => plan.masterIdByCode.get(p.key)!)
    ));

    await this.db.runTransaction(async (tx) => {
      // 1. Re-read everything the plan depends on and rebuild the scope.
      const courseRef = college.collection("courses").doc(ctx.course.id);
      const catalogRef = ctx.course.catalogId ? college.collection("courseCatalog").doc(ctx.course.catalogId) : null;
      const timingRefs = this.timingRefs(req.collegeId, ctx.course.id, ctx.course.durationYears);
      const [courseSnap, deptsSnap, sameCatalogSnap, catalogSnap, categoriesSnap, ...timingSnaps] = await Promise.all([
        tx.get(courseRef),
        tx.get(college.collection("departments")),
        ctx.course.catalogId ? tx.get(college.collection("courses").where("catalogId", "==", ctx.course.catalogId)) : Promise.resolve(null),
        catalogRef ? tx.get(catalogRef) : Promise.resolve(null),
        tx.get(college.collection("subjectCategories")),
        ...timingRefs.map((r) => tx.get(r)),
      ]);
      let fresh: ReturnType<CourseStructureImportService["buildContext"]>;
      try {
        fresh = this.buildContext(
          ctx.course.id, ctx.department.id, req.regulation,
          courseSnap.exists ? (courseSnap.data() as Course) : undefined,
          deptsSnap.docs.map((d) => ({ ...(d.data() as Department), id: d.id })),
          sameCatalogSnap ? sameCatalogSnap.docs.map((d) => ({ ...(d.data() as Course), id: d.id })) : [{ ...ctx.course }],
          catalogSnap?.exists ? (catalogSnap.data() as { regulations?: string[]; regulationBatches?: Record<string, string> }) : undefined,
          timingSnaps.map((s) => (s.exists ? (s.data() as Partial<CourseYearTiming>) : undefined)),
          customCategoriesFrom(categoriesSnap.docs.map((d) => d.data()))
        );
      } catch (err) {
        throw new CourseStructureConflictError(`The course or department changed during the import: ${(err as Error).message}`);
      }
      const recheck = validateCourseStructureRows(req.records, fresh.summary.scope);
      if (!recheck.ok) {
        throw new CourseStructureConflictError("Course-Year Timings or the department's assigned years changed during the import. Nothing was saved. Validate the file again.");
      }

      // 2. Targets must still be in the state the plan saw.
      const newMasterRefs = Array.from(plan.newMasterCodes).map((code) => subjects.doc(plan.masterIdByCode.get(code)!));
      const reusedRefs = reusedMasterIds.map((id) => subjects.doc(id));
      const instanceRefs = toWrite.map((p) => instances.doc(`${plan.masterIdByCode.get(p.key)}_${ctx.department.id}_${p.semester}`));
      const legacyRefs = Array.from(plan.legacyToDelete.keys()).map((id) => instances.doc(id.replace(/_\d+$/, "")));
      const snaps = newMasterRefs.length + reusedRefs.length + instanceRefs.length + legacyRefs.length > 0
        ? await tx.getAll(...newMasterRefs, ...reusedRefs, ...instanceRefs, ...legacyRefs)
        : [];
      let i = 0;
      for (const s of snaps.slice(i, (i += newMasterRefs.length))) {
        if (s.exists) throw new CourseStructureConflictError(`Subject ${(s.data() as Subject).code} was created by someone else during the import. Nothing was saved. Validate the file again.`);
      }
      const masters = new Map<string, Subject>();
      for (const s of snaps.slice(i, (i += reusedRefs.length))) {
        if (!s.exists || (s.data() as Subject).isActive === false) throw new CourseStructureConflictError("An existing subject this file links to was removed or deactivated during the import. Nothing was saved.");
        masters.set(s.id, s.data() as Subject);
      }
      for (const s of snaps.slice(i, (i += instanceRefs.length))) {
        if (s.exists && (s.data() as SubjectSemesterAssignment).isActive !== false) {
          throw new CourseStructureConflictError("Some of these subjects were assigned by someone else during the import. Nothing was saved. Validate the file again.");
        }
      }

      // 3. Writes - all or nothing.
      const now = new Date();
      for (const code of plan.newMasterCodes) {
        const id = plan.masterIdByCode.get(code)!;
        const payload = this.masterPayload(req, ctx, rowByCode.get(code)!, now);
        tx.create(subjects.doc(id), payload);
        masters.set(id, payload as Subject);
      }
      for (const p of toWrite) {
        const subjectId = plan.masterIdByCode.get(p.key)!;
        const instanceId = `${subjectId}_${ctx.department.id}_${p.semester}`;
        const legacy = plan.legacyToDelete.get(instanceId);
        tx.set(instances.doc(instanceId), buildSubjectInstancePayload(masters.get(subjectId)!, {
          collegeId: req.collegeId,
          subjectId,
          courseId: ctx.course.id,
          departmentId: ctx.department.id,
          departmentName: ctx.department.name,
          year: p.year,
          semester: p.semester,
          createdAt: legacy?.createdAt ?? now,
          now,
        }));
      }

      // Fan-out to managed branches: write copies under each branch's own
      // departmentId for the years this manager teaches (not the branch's years).
      // Each branch sees the same subjects in the same semesters, with its own
      // department context - but only for the shared years the manager owns.
      const managedBranches = fresh.allDepartments.find((d) => d.id === ctx.department.id)?.managedDepartments ?? [];
      if (managedBranches.length > 0) {
        for (const branchName of managedBranches) {
          const branchDept = fresh.allDepartments.find((d) => d.name === branchName);
          if (!branchDept) continue;
          const branchYears = managerTeachingYears(fresh.allDepartments, fresh.allDepartments.find((d) => d.id === ctx.department.id)!, ctx.course.catalogId);
          for (const p of toWrite) {
            // Only fan-out years the manager teaches (don't override branch's own years).
            if (!branchYears.includes(p.year)) continue;
            const subjectId = plan.masterIdByCode.get(p.key)!;
            const branchInstanceId = `${subjectId}_${branchDept.id}_${p.semester}`;
            tx.set(instances.doc(branchInstanceId), buildSubjectInstancePayload(masters.get(subjectId)!, {
              collegeId: req.collegeId,
              subjectId,
              courseId: ctx.course.id,
              departmentId: branchDept.id,
              departmentName: branchDept.name,
              year: p.year,
              semester: p.semester,
              createdAt: now,
              now,
            }));
          }
        }
      }

      for (const ref of legacyRefs) tx.delete(ref);
    });
  }

  // Reads back every instance the file maps to and checks the links
  // Teaching Assignments depends on. Runs after the commit; a problem here
  // means something else rewrote the data in between, and is reported, not
  // hidden.
  private async verify(req: CourseStructureRequest, ctx: LoadedContext, plan: Plan): Promise<{ checked: number; problems: string[] }> {
    const college = this.collegeRef(req.collegeId);
    const problems: string[] = [];
    if (plan.planRows.length === 0) return { checked: 0, problems };

    // Verify manager's assignments and managed branches' copies.
    const managerInstanceRefs = plan.planRows.map((p) => college.collection("subjectSemesterAssignments").doc(`${plan.masterIdByCode.get(p.key)}_${ctx.department.id}_${p.semester}`));
    const managedBranches = ctx.allDepartments.find((d) => d.id === ctx.department.id)?.managedDepartments ?? [];
    const branchInstanceRefs: ReturnType<typeof college.collection>["doc"][] = [];
    if (managedBranches.length > 0) {
      const managerYears = managerTeachingYears(ctx.allDepartments, ctx.allDepartments.find((d) => d.id === ctx.department.id)!, ctx.course.catalogId);
      for (const branchName of managedBranches) {
        const branchDept = ctx.allDepartments.find((d) => d.name === branchName);
        if (!branchDept) continue;
        for (const p of plan.planRows) {
          if (managerYears.includes(p.year)) {
            const subjectId = plan.masterIdByCode.get(p.key)!;
            branchInstanceRefs.push(college.collection("subjectSemesterAssignments").doc(`${subjectId}_${branchDept.id}_${p.semester}`));
          }
        }
      }
    }

    const masterIds = Array.from(new Set(plan.masterIdByCode.values()));
    const [managerSnaps, branchSnaps, masterSnaps] = await Promise.all([
      this.db.getAll(...managerInstanceRefs),
      branchInstanceRefs.length > 0 ? this.db.getAll(...branchInstanceRefs) : Promise.resolve([]),
      this.db.getAll(...masterIds.map((id) => college.collection("subjects").doc(id))),
    ]);
    const allInstanceSnaps = [...managerSnaps, ...(branchSnaps as ReturnType<typeof masterSnaps>)];
    const masters = new Map(masterSnaps.map((s) => [s.id, s.exists ? (s.data() as Subject) : null]));
    // Verify manager's instances
    plan.planRows.forEach((p, idx) => {
      const snap = managerSnaps[idx];
      const label = `Row ${p.row} (${p.code})`;
      if (!snap.exists) { problems.push(`${label}: semester assignment is missing.`); return; }
      const a = snap.data() as SubjectSemesterAssignment;
      const master = masters.get(a.subjectId);
      if (!master) problems.push(`${label}: master subject is missing.`);
      else if ((master.regulation ?? "") !== req.regulation) problems.push(`${label}: master subject is tagged ${master.regulation || "no regulation"}, not ${req.regulation}.`);
      if ((a.regulation ?? "") !== req.regulation) problems.push(`${label}: assignment regulation is ${a.regulation || "empty"}.`);
      if (a.courseId !== ctx.course.id) problems.push(`${label}: assignment points to a different course.`);
      if (a.departmentId !== ctx.department.id) problems.push(`${label}: assignment points to a different department.`);
      if (a.year !== p.year || a.semester !== p.semester) problems.push(`${label}: assignment is Year ${a.year} Semester ${a.semester}, expected Year ${p.year} Semester ${p.semester}.`);
      if (a.isActive === false) problems.push(`${label}: assignment is inactive.`);
    });

    // Verify branch instances (same checks as manager)
    let branchIdx = 0;
    if (managedBranches.length > 0) {
      const managerYears = managerTeachingYears(ctx.allDepartments, ctx.allDepartments.find((d) => d.id === ctx.department.id)!, ctx.course.catalogId);
      for (const branchName of managedBranches) {
        const branchDept = ctx.allDepartments.find((d) => d.name === branchName);
        if (!branchDept) continue;
        for (const p of plan.planRows) {
          if (!managerYears.includes(p.year)) continue;
          const snap = branchSnaps[branchIdx++];
          const label = `Branch ${branchDept.name}, Row ${p.row} (${p.code})`;
          if (!snap.exists) { problems.push(`${label}: semester assignment is missing.`); continue; }
          const a = snap.data() as SubjectSemesterAssignment;
          if (a.departmentId !== branchDept.id) problems.push(`${label}: assignment points to wrong department.`);
          if (a.isActive === false) problems.push(`${label}: assignment is inactive.`);
        }
      }
    }

    if (problems.length > 0) console.error("[CourseStructureImportService.verify]", problems);
    return { checked: plan.planRows.length + branchInstanceRefs.length, problems };
  }
}
