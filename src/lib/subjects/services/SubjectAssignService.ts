import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { getInChunks } from "@/lib/firestore/inQuery";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notConfiguredMessage } from "@/lib/college/taughtYears";
import { currentAcademicStartYear, regulationsForCourseYearByBatch } from "@/lib/college/academicSession";
import { assignableYearsForDepartment } from "../teachableYears";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import { courseOwnershipError, semestersFrom } from "../courseOwnership";
import { normalizeSubjectCode } from "../subjectIdentity";
import { ASSIGN_MAX_CODES } from "../limits";
import { buildSubjectInstancePayload } from "./SubjectInstanceService";
import { SubjectRequestError, type SubjectActor } from "./SubjectMasterService";
import type { Course, CourseYearTiming, Department, Subject, SubjectSemesterAssignment } from "@/types";

// Assign by code: the ONLY way a master subject becomes a department's semester
// subject. The Office picks Course + Regulation + Department + Year + Semester,
// types or pastes Subject Codes, and every code is checked and assigned in one
// all-or-nothing step. Nothing here reads a file.

export { ASSIGN_MAX_CODES };

export type AssignCodeStatus =
  | "ASSIGN"            // will be (or was) assigned
  | "ALREADY_ASSIGNED"  // already in this department's semester - left exactly as it is
  | "NOT_FOUND"         // no subject with this code for the course + regulation
  | "INACTIVE"          // the subject exists but is deactivated
  | "AMBIGUOUS";        // more than one subject carries the code (legacy data) - run the duplicate audit

export interface AssignCodeResult {
  code: string;
  status: AssignCodeStatus;
  subjectId?: string;
  name?: string;
  message?: string;
}

export interface AssignByCodeRequest {
  collegeId: string;
  /** The department's own Course doc for the catalog course. */
  courseId: string;
  departmentId: string;
  regulation: string;
  year: number;
  semester: number;
  /** Codes in the order typed; that order becomes the subjects' display order in the semester. */
  codes: string[];
  actor?: SubjectActor;
}

export interface AssignByCodeResult {
  ok: boolean;
  mode: "validate" | "commit";
  plan: AssignCodeResult[];
  warnings: string[];
  counts: { toAssign: number; alreadyAssigned: number; problems: number; repeatedInList: number };
}

/** Splits what was typed or pasted into codes: any mix of newlines, commas, semicolons and spaces. */
export function parseCodeList(text: string): string[] {
  return text.split(/[\s,;]+/).map(normalizeSubjectCode).filter(Boolean);
}

export interface AssignScopeYear {
  year: number;
  /** Run for this department by a managing department (the shared first year) - its subjects still belong to THIS department. */
  shared: boolean;
  semesters: number[];
}
export interface AssignScope {
  years: AssignScopeYear[];
  /** Set when this department manages branches: those years are assigned on the branch, not here. */
  managesBranches: { branch: string; years: number[] }[];
}

type DeptDoc = Department & { id: string };
type CourseDoc = Course & { id: string };

export class SubjectAssignService {
  constructor(private db: Firestore = getAdminDb()) {}

  /** The course, department and everything that decides where subjects may go. */
  private async loadWhere(collegeId: string, courseId: string, departmentId: string) {
    const college = this.db.collection("colleges").doc(collegeId);
    const [courseSnap, deptsSnap] = await Promise.all([
      college.collection("courses").doc(courseId).get(),
      college.collection("departments").get(),
    ]);
    if (!courseSnap.exists) throw new SubjectRequestError("Course not found.", 404);
    const course = { ...(courseSnap.data() as Course), id: courseId, durationYears: Number((courseSnap.data() as Course).durationYears) || 0 } as CourseDoc;
    if (course.isActive === false) throw new SubjectRequestError("This course is inactive.");
    const departments = deptsSnap.docs.map((d) => ({ ...(d.data() as Department), id: d.id })) as DeptDoc[];
    const department = departments.find((d) => d.id === departmentId);
    if (!department) throw new SubjectRequestError("Department not found.", 404);
    const [sameCatalogSnap, catalogSnap] = await Promise.all([
      course.catalogId ? college.collection("courses").where("catalogId", "==", course.catalogId).get() : Promise.resolve(null),
      course.catalogId ? college.collection("courseCatalog").doc(course.catalogId).get() : Promise.resolve(null),
    ]);
    const sameCatalog = (sameCatalogSnap ? sameCatalogSnap.docs.map((d) => ({ ...(d.data() as Course), id: d.id })) : [course]) as CourseDoc[];
    const catalog = catalogSnap?.exists ? (catalogSnap.data() as { regulations?: string[]; regulationBatches?: Record<string, string> }) : undefined;
    return { college, course, departments, department, sameCatalog, catalog, years: assignableYearsForDepartment(course, department, departments) };
  }

  /**
   * The semesters configured for `year`: the department's own Course-Year Timings or - for a shared
   * year - the managing department's (the Principal configures the shared first year once, where it is run).
   */
  private async semestersOf(
    college: FirebaseFirestore.DocumentReference,
    course: CourseDoc,
    year: number,
    departments: DeptDoc[],
    sameCatalog: CourseDoc[],
  ): Promise<number[]> {
    const ids = [course.id];
    const inherited = inheritedTimingCourseId(course, year, departments, sameCatalog);
    if (inherited && inherited !== course.id) ids.push(inherited);
    const snaps = await this.db.getAll(...ids.map((id) => college.collection("courseYearTimings").doc(`${id}_year${year}`)));
    for (const s of snaps) {
      const sems = semestersFrom(s.exists ? (s.data() as Partial<CourseYearTiming>) : undefined);
      if (sems.length > 0) return sems;
    }
    return [];
  }

  /** What the Assign tab offers for a department: assignable years and, per year, its semesters. */
  async getScope(collegeId: string, courseId: string, departmentId: string): Promise<AssignScope> {
    const w = await this.loadWhere(collegeId, courseId, departmentId);
    const managed = w.years.managedBranchYears;
    const blocked = new Set(managed.flatMap((m) => m.years));
    const all = [
      ...w.years.own.filter((y) => !blocked.has(y)).map((year) => ({ year, shared: false })),
      ...w.years.shared.map((year) => ({ year, shared: true })),
    ].sort((a, b) => a.year - b.year);
    const years = await Promise.all(all.map(async (y) => ({ ...y, semesters: await this.semestersOf(w.college, w.course, y.year, w.departments, w.sameCatalog) })));
    return { years, managesBranches: managed };
  }

  async run(req: AssignByCodeRequest, mode: "validate" | "commit"): Promise<AssignByCodeResult> {
    const { collegeId, courseId, departmentId, year, semester } = req;
    const regulation = req.regulation.trim();
    if (!regulation) throw new SubjectRequestError("Select a regulation first.");
    if (!Number.isInteger(year) || year < 1) throw new SubjectRequestError("Select a year.");
    if (!Number.isInteger(semester) || semester < 1) throw new SubjectRequestError("Select a semester.");

    // Repeats in the list are ignored (and counted), not errors: pasting a code twice is harmless.
    const seen = new Set<string>();
    const codes: string[] = [];
    let repeated = 0;
    for (const c of req.codes.map(normalizeSubjectCode).filter(Boolean)) {
      if (seen.has(c)) { repeated++; continue; }
      seen.add(c);
      codes.push(c);
    }
    if (codes.length === 0) throw new SubjectRequestError("Enter at least one subject code.");
    if (codes.length > ASSIGN_MAX_CODES) throw new SubjectRequestError(`Maximum ${ASSIGN_MAX_CODES} codes at a time.`);

    const w = await this.loadWhere(collegeId, courseId, departmentId);
    const { college, course, departments, department, sameCatalog, catalog } = w;

    // Everything about WHERE the subjects go must hold before a single code is looked at.
    const ownership = courseOwnershipError(course, department, departments, sameCatalog);
    if (ownership) throw new SubjectRequestError(ownership);
    const regulations = catalog?.regulations ?? [];
    if (regulations.length === 0) throw new SubjectRequestError(`${course.name} has no regulations configured in the Course Catalog.`);
    if (!regulations.includes(regulation)) {
      throw new SubjectRequestError(`Regulation ${regulation} isn't assigned to ${course.name} (available: ${regulations.join(", ")}).`);
    }
    if (year > course.durationYears) throw new SubjectRequestError(`${course.name} runs ${course.durationYears} year${course.durationYears === 1 ? "" : "s"}; Year ${year} doesn't exist.`);
    // A shared year's subjects belong to the CORE department; its manager reaches them through the managed link.
    const managed = w.years.managedBranchYears.filter((m) => m.years.includes(year));
    if (managed.length > 0) {
      throw new SubjectRequestError(
        `"${department.name}" runs Year ${year} for ${managed.map((m) => m.branch).join(", ")}. Assign these subjects to ${managed.length === 1 ? "that department" : "each of those departments"} instead - ${department.name} gets access to them automatically.`,
      );
    }
    if (w.years.own.length === 0 && w.years.shared.length === 0) throw new SubjectRequestError(notConfiguredMessage(department.name, year, course.name));
    if (!w.years.own.includes(year) && !w.years.shared.includes(year)) {
      throw new SubjectRequestError(`"${department.name}" isn't scoped to teach ${course.name} in Year ${year} - check its Years Taught.`);
    }
    const configured = await this.semestersOf(college, course, year, departments, sameCatalog);
    if (!configured.includes(semester)) {
      throw new SubjectRequestError(
        configured.length === 0
          ? `Year ${year} of ${course.name} has no semesters configured in Course-Year Timings.`
          : `Semester ${semester} doesn't belong to Year ${year} of ${course.name} (its semesters: ${configured.join(", ")}).`,
      );
    }

    const warnings: string[] = [];
    const covering = regulationsForCourseYearByBatch(catalog?.regulationBatches ?? {}, year, currentAcademicStartYear(), regulations);
    if (covering.length > 0 && !covering.includes(regulation)) {
      warnings.push(`Year ${year} is currently taught under ${covering.join(", ")}, not ${regulation}. These subjects will be ready for when a ${regulation} batch reaches Year ${year}.`);
    }

    // Resolve codes -> subjects: only docs carrying a typed code are read, then narrowed to this catalog course + regulation.
    const groupIds = new Set(sameCatalog.map((c) => c.id));
    const found = await getInChunks(codes, (chunk) => college.collection("subjects").where("code", "in", chunk));
    const byCode = new Map<string, (Subject & { id: string })[]>();
    for (const d of found) {
      const s = { ...(d.data() as Subject), id: d.id };
      if ((s.regulation ?? "").trim() !== regulation || !s.courseId || !groupIds.has(s.courseId)) continue;
      const k = normalizeSubjectCode(s.code);
      byCode.set(k, [...(byCode.get(k) ?? []), s]);
    }

    const plan: AssignCodeResult[] = codes.map((code) => {
      const hits = byCode.get(code) ?? [];
      if (hits.length === 0) return { code, status: "NOT_FOUND", message: `No subject with code ${code} for ${course.name} · ${regulation}. Add it under Subjects first.` };
      if (hits.length > 1) return { code, status: "AMBIGUOUS", message: `${hits.length} subjects share code ${code} for ${regulation}. Fix the duplicate under Subjects first.` };
      const s = hits[0];
      if (s.isActive === false) return { code, status: "INACTIVE", subjectId: s.id, name: s.name, message: `${s.name} is deactivated. Reactivate it under Subjects first.` };
      return { code, status: "ASSIGN", subjectId: s.id, name: s.name };
    });

    // Already in this department's semester? (also the pre-semester-key legacy id)
    const toCheck = plan.filter((p) => p.status === "ASSIGN");
    if (toCheck.length > 0) {
      const instances = college.collection("subjectSemesterAssignments");
      const refs = toCheck.flatMap((p) => [instances.doc(`${p.subjectId}_${departmentId}_${semester}`), instances.doc(`${p.subjectId}_${departmentId}`)]);
      const snaps = await this.db.getAll(...refs);
      toCheck.forEach((p, i) => {
        const current = snaps[i * 2];
        const legacy = snaps[i * 2 + 1];
        const liveCurrent = current.exists && (current.data() as { isActive?: boolean }).isActive !== false;
        const liveLegacy = legacy.exists && (legacy.data() as { semester?: number; isActive?: boolean }).semester === semester && (legacy.data() as { isActive?: boolean }).isActive !== false;
        if (liveCurrent || liveLegacy) { p.status = "ALREADY_ASSIGNED"; p.message = "Already in this semester - left as it is."; }
      });
    }

    const counts = {
      toAssign: plan.filter((p) => p.status === "ASSIGN").length,
      alreadyAssigned: plan.filter((p) => p.status === "ALREADY_ASSIGNED").length,
      problems: plan.filter((p) => p.status === "NOT_FOUND" || p.status === "INACTIVE" || p.status === "AMBIGUOUS").length,
      repeatedInList: repeated,
    };
    const ok = counts.problems === 0;
    if (!ok || mode === "validate") return { ok, mode, plan, warnings, counts };

    if (counts.toAssign > 0) await this.commit(req, { course, department, plan });
    return { ok, mode, plan, warnings, counts };
  }

  private async commit(req: AssignByCodeRequest, ctx: { course: Course & { id: string }; department: Department & { id: string }; plan: AssignCodeResult[] }) {
    const { collegeId, departmentId, semester, year } = req;
    const college = this.db.collection("colleges").doc(collegeId);
    const instances = college.collection("subjectSemesterAssignments");
    const subjects = college.collection("subjects");
    const fresh = ctx.plan.filter((p) => p.status === "ASSIGN");

    await this.db.runTransaction(async (tx) => {
      // The state the plan saw must still hold: masters active, nothing assigned in the meantime.
      const masterSnaps = await tx.getAll(...fresh.map((p) => subjects.doc(p.subjectId!)));
      const instanceRefs = fresh.map((p) => instances.doc(`${p.subjectId}_${departmentId}_${semester}`));
      const instanceSnaps = await tx.getAll(...instanceRefs);
      const slot = await tx.get(instances.where("courseId", "==", ctx.course.id));
      masterSnaps.forEach((m, i) => {
        if (!m.exists || (m.data() as Subject).isActive === false) throw new SubjectRequestError(`${fresh[i].code} was removed or deactivated while assigning. Nothing was saved.`, 409);
      });
      instanceSnaps.forEach((s, i) => {
        if (s.exists && (s.data() as SubjectSemesterAssignment).isActive !== false) {
          throw new SubjectRequestError(`${fresh[i].code} was assigned by someone else while assigning. Nothing was saved.`, 409);
        }
      });
      // New subjects go after whatever the semester already holds, in the order typed.
      const serials = slot.docs
        .map((d) => d.data() as SubjectSemesterAssignment)
        .filter((a) => a.departmentId === departmentId && a.semester === semester && a.isActive !== false)
        .map((a) => a.serialNumber ?? 0);
      const base = serials.length > 0 ? Math.max(...serials) : 0;
      const now = new Date();
      fresh.forEach((p, i) => {
        const prior = instanceSnaps[i];
        const payload = buildSubjectInstancePayload({ ...(masterSnaps[i].data() as Subject), id: p.subjectId! }, {
          collegeId,
          subjectId: p.subjectId!,
          courseId: ctx.course.id,
          departmentId,
          departmentName: ctx.department.name,
          year,
          semester,
          createdAt: prior.exists ? (prior.data() as { createdAt?: unknown }).createdAt ?? now : now,
          now,
          serialNumber: base + i + 1,
        });
        tx.set(instanceRefs[i], payload);
      });
    });

    await writeAuditLogSafe(this.db, collegeId, {
      action: "SUBJECTS_ASSIGNED",
      performedBy: req.actor?.uid ?? "unknown",
      performedByName: req.actor?.name,
      targetId: departmentId,
      details: { courseId: ctx.course.id, course: ctx.course.name, department: ctx.department.name, regulation: req.regulation, year, semester, codes: fresh.map((p) => p.code) },
    });
  }
}
