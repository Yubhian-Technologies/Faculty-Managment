// Removing a year from a department's "Years Taught" must not strand data that already depends on it.
//
// Sections, students, teaching assignments, timetable slots, subject instances, course-year timings
// and exam configurations are all filed under (department, course, year). Years Taught used to be
// editable with no look at any of them (college/departments PATCH), so a removed year silently left
// them orphaned - invisible to every picker that is scoped by Years Taught, and for a shared-year
// manager the edit rights over them vanished with the year.
//
// Two halves:
//  - findLostYears: PURE. Compares who may host which (department, course, year) BEFORE and AFTER a
//    proposed edit, using the very same rule section creation uses (taughtYears.admitYear, including a
//    shared-year manager covering a managed branch). A year still covered some other way (e.g. the
//    manager still teaches it) is not "lost", so a harmless edit is never blocked.
//  - countYearDependents / findBlockingYearDependents: look for data in the lost slots. Reads only -
//    nothing is changed here; the caller refuses the edit (409) when anything is found.

import { admitYear, type YearsDepartment } from "@/lib/college/taughtYears";
import { MAX_COURSE_DURATION_YEARS } from "@/lib/college/courseYears";

export type YearsDepartmentWithId = YearsDepartment & { id: string; name?: string };

export interface CourseLite {
  id: string;
  departmentId: string;
  catalogId?: string;
  name: string;
  durationYears: number;
}

/** One course "family": every department's Course doc that is the same programme. */
export interface CourseGroup {
  key: string;
  catalogId?: string;
  name: string;
  courseIds: string[];
  maxYear: number;
}

export function groupCourses(courses: CourseLite[]): CourseGroup[] {
  const map = new Map<string, CourseGroup>();
  for (const c of courses) {
    // Catalog-linked courses group by catalog id; a legacy pre-catalog course by its normalised name
    // (it can only have flat years, so catalogId stays undefined for the rule).
    const key = c.catalogId ? `catalog:${c.catalogId}` : `name:${c.name.trim().toLowerCase()}`;
    const duration = Number.isInteger(Number(c.durationYears)) && Number(c.durationYears) >= 1
      ? Number(c.durationYears)
      : MAX_COURSE_DURATION_YEARS;
    const g = map.get(key);
    if (g) {
      g.courseIds.push(c.id);
      g.maxYear = Math.max(g.maxYear, duration);
    } else {
      map.set(key, { key, catalogId: c.catalogId, name: c.name, courseIds: [c.id], maxYear: duration });
    }
  }
  return Array.from(map.values());
}

export interface YearLoss {
  departmentId: string;
  departmentName: string;
  group: CourseGroup;
  year: number;
}

/**
 * (department, course, year) slots a department could host BEFORE the edit and cannot AFTER it.
 * `before` / `after` are the full department lists; `after` is `before` with the proposed edit applied.
 */
export function findLostYears(
  before: YearsDepartmentWithId[],
  after: YearsDepartmentWithId[],
  courses: CourseLite[]
): YearLoss[] {
  const groups = groupCourses(courses);
  const lost: YearLoss[] = [];
  for (const dept of after) {
    const prev = before.find((d) => d.id === dept.id);
    if (!prev || !dept.name) continue;
    for (const group of groups) {
      for (let year = 1; year <= group.maxYear; year++) {
        const hadIt = admitYear({ department: prev, allDepartments: before, catalogId: group.catalogId, year, viaManagedBranch: true }).ok;
        if (!hadIt) continue;
        const hasIt = admitYear({ department: dept, allDepartments: after, catalogId: group.catalogId, year, viaManagedBranch: true }).ok;
        if (!hasIt) lost.push({ departmentId: dept.id, departmentName: dept.name, group, year });
      }
    }
  }
  return lost;
}

/** A department's Years Taught for one course group going from "some years" to "none" - refused outright. */
export function findEmptiedCourses(
  before: YearsDepartmentWithId[],
  after: YearsDepartmentWithId[],
  courses: CourseLite[]
): { departmentName: string; courseName: string }[] {
  const out: { departmentName: string; courseName: string }[] = [];
  for (const dept of after) {
    const prev = before.find((d) => d.id === dept.id);
    if (!prev || !dept.name) continue;
    for (const group of groupCourses(courses.filter((c) => c.departmentId === dept.id))) {
      const hadAny = Array.from({ length: group.maxYear }, (_, i) => i + 1)
        .some((year) => admitYear({ department: prev, allDepartments: before, catalogId: group.catalogId, year }).ok);
      const hasAny = Array.from({ length: group.maxYear }, (_, i) => i + 1)
        .some((year) => admitYear({ department: dept, allDepartments: after, catalogId: group.catalogId, year }).ok);
      if (hadAny && !hasAny) out.push({ departmentName: dept.name, courseName: group.name });
    }
  }
  return out;
}

export interface DependentCounts {
  sections: number;
  students: number;
  teachingAssignments: number;
  timetableSlots: number;
  subjectInstances: number;
  timings: number;
  examConfigs: number;
}

export interface BlockedYear {
  departmentName: string;
  courseName: string;
  year: number;
  counts: DependentCounts;
  total: number;
}

const emptyCounts = (): DependentCounts => ({
  sections: 0, students: 0, teachingAssignments: 0, timetableSlots: 0, subjectInstances: 0, timings: 0, examConfigs: 0,
});

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** One (course family, year) slot - optionally narrowed to one department - to look for data in. */
export interface DependentSlot {
  year: number;
  /** Every Course doc of the course family (the same programme across departments). */
  courseIds: string[];
  /** The family's course NAMES - older student rows carry only the name text, no courseId. */
  courseNames: string[];
  /** When set, only data filed under this department (sections / students / assignments / slots). */
  departmentName?: string;
  /** When set, only this department's subject assignments. */
  departmentId?: string;
  /** Course docs whose timings and exam configurations belong to this slot (keyed by courseId). */
  ownCourseIds: string[];
}

/** Counts the data filed under one slot. Reads only. */
export async function countSlotDependents(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  slot: DependentSlot
): Promise<DependentCounts> {
  const college = db.collection("colleges").doc(collegeId);
  const { year, courseIds, courseNames, departmentName, departmentId, ownCourseIds } = slot;
  const counts = emptyCounts();

  // Docs of `collection` filed under this year whose courseId is one of the course family (and, when a
  // department is given, under that department). Equality filters only, so no composite index is needed.
  const countByCourse = async (collection: string, deptField: string, deptValue: string | undefined): Promise<number> => {
    let total = 0;
    for (const ids of chunk(courseIds, 30)) {
      let q: FirebaseFirestore.Query = college.collection(collection).where("year", "==", year).where("courseId", "in", ids);
      if (deptValue !== undefined) q = q.where(deptField, "==", deptValue);
      total += (await q.count().get()).data().count;
    }
    return total;
  };

  counts.sections = await countByCourse("sections", "department", departmentName);
  counts.teachingAssignments = await countByCourse("teachingAssignments", "department", departmentName);
  counts.timetableSlots = await countByCourse("timetableSlots", "department", departmentName);
  counts.subjectInstances = await countByCourse("subjectSemesterAssignments", "departmentId", departmentId);

  // Students: a graduated student keeps their final year but no longer depends on anything. The course may
  // be a courseId or (older rows) only the course NAME text.
  const names = new Set(courseNames);
  let studentQuery: FirebaseFirestore.Query = college.collection("students").where("year", "==", year);
  if (departmentName !== undefined) studentQuery = studentQuery.where("department", "==", departmentName);
  const studentSnap = await studentQuery.select("courseId", "course", "status").get();
  counts.students = studentSnap.docs.filter((d) => {
    const s = d.data() as { courseId?: string; course?: string; status?: string };
    if (s.status === "GRADUATED") return false;
    return s.courseId ? courseIds.includes(s.courseId) : !!s.course && names.has(s.course);
  }).length;

  // Timings and exam configurations are keyed by courseId (so they belong to the department that OWNS the Course doc).
  if (ownCourseIds.length > 0) {
    const timingSnaps = await db.getAll(...ownCourseIds.map((id) => college.collection("courseYearTimings").doc(`${id}_year${year}`)));
    counts.timings = timingSnaps.filter((s) => s.exists).length;
    for (const ids of chunk(ownCourseIds, 30)) {
      const snap = await college.collection("examConfigurations").where("courseId", "in", ids).where("year", "==", year).count().get();
      counts.examConfigs += snap.data().count;
    }
  }
  return counts;
}

/** Counts the data filed under one lost (department, course, year) slot. Reads only. */
export async function countYearDependents(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  loss: YearLoss,
  courses: CourseLite[]
): Promise<DependentCounts> {
  const { departmentName, departmentId, year, group } = loss;
  return countSlotDependents(db, collegeId, {
    year,
    courseIds: group.courseIds,
    courseNames: courses.filter((c) => group.courseIds.includes(c.id)).map((c) => c.name),
    departmentName,
    departmentId,
    ownCourseIds: courses.filter((c) => c.departmentId === departmentId && group.courseIds.includes(c.id)).map((c) => c.id),
  });
}

export const sumCounts = (c: DependentCounts): number =>
  c.sections + c.students + c.teachingAssignments + c.timetableSlots + c.subjectInstances + c.timings + c.examConfigs;

/** The lost slots that still have data filed under them. Empty array = the edit is safe. */
export async function findBlockingYearDependents(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  before: YearsDepartmentWithId[],
  after: YearsDepartmentWithId[],
  courses: CourseLite[]
): Promise<BlockedYear[]> {
  const blocked: BlockedYear[] = [];
  for (const loss of findLostYears(before, after, courses)) {
    const counts = await countYearDependents(db, collegeId, loss, courses);
    const total = sumCounts(counts);
    if (total > 0) blocked.push({ departmentName: loss.departmentName, courseName: loss.group.name, year: loss.year, counts, total });
  }
  return blocked;
}

const LABELS: [keyof DependentCounts, string, string][] = [
  ["sections", "section", "sections"],
  ["students", "student", "students"],
  ["teachingAssignments", "teaching assignment", "teaching assignments"],
  ["timetableSlots", "timetable slot", "timetable slots"],
  ["subjectInstances", "subject assignment", "subject assignments"],
  ["timings", "timing setup", "timing setups"],
  ["examConfigs", "exam configuration", "exam configurations"],
];

export function describeCounts(c: DependentCounts): string {
  return LABELS.filter(([k]) => c[k] > 0).map(([k, one, many]) => `${c[k]} ${c[k] === 1 ? one : many}`).join(", ");
}

export function yearRemovalMessage(blocked: BlockedYear[]): string {
  const lines = blocked.slice(0, 5).map((b) => `Year ${b.year} of ${b.courseName} in ${b.departmentName}: ${describeCounts(b.counts)}`);
  const more = blocked.length > 5 ? ` (and ${blocked.length - 5} more)` : "";
  return `Can't remove a year that still has data. ${lines.join("; ")}${more}. Move or remove that data first - nothing was changed.`;
}

export interface YearsEditRefusal {
  status: 400 | 409;
  body: { error: string; code: "YEARS_WOULD_BE_EMPTY" | "YEARS_HAVE_DEPENDENTS"; blocked?: BlockedYear[] };
}

/**
 * The single guard for every edit of a department's Years Taught (per-course set / clear, flat years).
 * Loads the college's departments and courses, applies `mutate` to the department being edited, and
 * refuses when the edit
 *   - would leave a department with NO Years Taught for a course it offers (an empty list must never be
 *     how a course is "opened up" - see taughtYears.ts) - 400, or
 *   - would remove a (course, year) that sections, students, teaching assignments, timetable slots,
 *     subject assignments, timings or exam configurations are still filed under - 409.
 * Returns null when the edit is safe. Reads only; the caller writes afterwards.
 */
export async function checkYearsEdit(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  deptId: string,
  mutate: (d: YearsDepartmentWithId) => YearsDepartmentWithId
): Promise<YearsEditRefusal | null> {
  const college = db.collection("colleges").doc(collegeId);
  const [deptSnap, courseSnap] = await Promise.all([college.collection("departments").get(), college.collection("courses").get()]);
  const before = deptSnap.docs.map((d) => ({ ...(d.data() as object), id: d.id })) as YearsDepartmentWithId[];
  const courses = courseSnap.docs.map((d) => {
    const c = d.data() as Partial<CourseLite>;
    return { id: d.id, departmentId: c.departmentId ?? "", catalogId: c.catalogId, name: c.name ?? "", durationYears: Number(c.durationYears) };
  }) as CourseLite[];
  const after = before.map((d) => (d.id === deptId ? mutate(d) : d));

  const emptied = findEmptiedCourses(before, after, courses);
  if (emptied.length > 0) {
    const e = emptied[0];
    return {
      status: 400,
      body: {
        code: "YEARS_WOULD_BE_EMPTY",
        error: `This would leave "${e.departmentName}" with no Years Taught for ${e.courseName}. A department must keep at least one year - an empty list does not mean "all years". Nothing was changed.`,
      },
    };
  }
  const blocked = await findBlockingYearDependents(db, collegeId, before, after, courses);
  if (blocked.length > 0) {
    return { status: 409, body: { code: "YEARS_HAVE_DEPENDENTS", error: yearRemovalMessage(blocked), blocked } };
  }
  return null;
}
