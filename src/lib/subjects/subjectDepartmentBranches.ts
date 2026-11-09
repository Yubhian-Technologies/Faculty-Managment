import { facultyManageableDepartmentNames, type HodDepartmentScope } from "@/lib/departments/scope";
import { cachedCollectionDocs, cachedValue } from "@/lib/firestore/sharedReads";
import { getInChunks } from "@/lib/firestore/inQuery";

// A Subject Department HOD (e.g. Basic Science - Mathematics) looks after subjects that are filed under the BRANCHES
// they are taught in (Linear Algebra under CSE, ECE ...), so their own department has nothing filed under it. These
// are the subjects their department looks after and the branches teaching them - read-only access to those branches'
// semester subjects (HOD > Subjects). Own department + sub-departments only; a managed (1st-year coordination)
// branch is already in the HOD's scope.

type Db = FirebaseFirestore.Firestore;

export interface TaughtBranch {
  departmentId: string;
  departmentName: string;
  /** Per programme (key = catalogId, else "name:<course name>" - the page's own course key): the branch's course docs
   *  holding those subjects (the page reads them by course) and the years they are taught there. */
  programmes: Record<string, { courseIds: string[]; years: number[] }>;
}

/** One semester placement of a subject their department looks after, in one branch (read-only view rows). */
export interface OwnedPlacement {
  id: string;
  subjectId: string; subjectName: string; subjectCode: string;
  branchId: string; branchName: string;
  /** Programme key (catalogId, else "name:<course name>"), year and semester it sits in. */
  programme: string; year: number; semester: number;
  regulation: string | null; category: string | null; customCategory: string | null; type: string | null;
  lectureHours: number | null; tutorialHours: number | null; practicalHours: number | null; credits: number | null; hoursPerWeek: number | null;
}

export interface SubjectDepartmentBranches {
  /** Master subjects whose Subject Department is the HOD's (own / sub-department). */
  subjects: FirebaseFirestore.QueryDocumentSnapshot[];
  branches: TaughtBranch[];
  placements: OwnedPlacement[];
}

async function load(db: Db, collegeId: string, scope: HodDepartmentScope): Promise<SubjectDepartmentBranches> {
  const college = db.collection("colleges").doc(collegeId);
  const [departments, courses] = await Promise.all([cachedCollectionDocs(db, collegeId, "departments"), cachedCollectionDocs(db, collegeId, "courses")]);
  const programmeOf = new Map(courses.map((c) => {
    const d = c.data() as { catalogId?: string; name?: string };
    return [c.id, d.catalogId || `name:${d.name ?? ""}`];
  }));
  const nameOf = new Map(departments.map((d) => [d.id, String((d.data() as { name?: string }).name ?? "").trim()]));
  const idOf = new Map([...nameOf].map(([id, n]) => [n, id]));
  const mine = new Set(facultyManageableDepartmentNames(scope));
  const ownIds = [...nameOf].filter(([, n]) => mine.has(n)).map(([id]) => id);
  const col = college.collection("subjects");
  // The list (two departments possible), and the single field saved before the list existed.
  const [listed, single] = await Promise.all([
    getInChunks(ownIds, (chunk) => col.where("ownerDepartmentIds", "array-contains-any", chunk)),
    getInChunks(ownIds, (chunk) => col.where("ownerDepartmentId", "in", chunk)),
  ]);
  const subjects = [...new Map([...listed, ...single].map((d) => [d.id, d])).values()];
  const placed = await getInChunks(subjects.map((s) => s.id), (chunk) =>
    college.collection("subjectSemesterAssignments").where("subjectId", "in", chunk).select("departmentId", "courseId", "year", "semester", "secondaryDepartmentNames", "subjectId", "subjectName", "subjectCode", "regulation",
      "category", "customCategory", "type", "lectureHours", "tutorialHours", "practicalHours", "credits", "hoursPerWeek"));
  const placements: OwnedPlacement[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const byBranch = new Map<string, Map<string, { courseIds: Set<string>; years: Set<number> }>>();
  const add = (departmentId: string, courseId: string, year: unknown) => {
    const key = programmeOf.get(courseId);
    if (!departmentId || !nameOf.has(departmentId) || !key) return;
    const b = byBranch.get(departmentId) ?? new Map<string, { courseIds: Set<string>; years: Set<number> }>();
    const p = b.get(key) ?? { courseIds: new Set<string>(), years: new Set<number>() };
    p.courseIds.add(courseId);
    if (Number(year) > 0) p.years.add(Number(year));
    b.set(key, p);
    byBranch.set(departmentId, b);
  };
  for (const p of placed) {
    const a = p.data() as { departmentId?: string; courseId?: string; year?: number; secondaryDepartmentNames?: string[] };
    const narrowed = (a.secondaryDepartmentNames ?? []).map((n) => idOf.get(n)).filter((x): x is string => !!x);
    // A row narrowed to core branches ("Target core departments") is theirs; otherwise the department it is filed under.
    for (const id of narrowed.length ? narrowed : [a.departmentId ?? ""]) {
      add(id, a.courseId ?? "", a.year);
      const programme = programmeOf.get(a.courseId ?? "");
      if (!programme || !nameOf.has(id)) continue;
      const x = p.data() as Record<string, unknown>;
      placements.push({
        id: `${p.id}__${id}`, subjectId: String(x.subjectId ?? ""), subjectName: String(x.subjectName ?? ""), subjectCode: String(x.subjectCode ?? ""),
        branchId: id, branchName: nameOf.get(id) ?? "", programme, year: Number(a.year) || 0, semester: Number(x.semester) || 0,
        regulation: str(x.regulation), category: str(x.category), customCategory: str(x.customCategory), type: str(x.type),
        lectureHours: num(x.lectureHours), tutorialHours: num(x.tutorialHours), practicalHours: num(x.practicalHours), credits: num(x.credits), hoursPerWeek: num(x.hoursPerWeek),
      });
    }
  }
  const branches = [...byBranch].map(([id, b]) => ({
    departmentId: id, departmentName: nameOf.get(id) ?? "",
    programmes: Object.fromEntries([...b].map(([key, p]) => [key, { courseIds: [...p.courseIds], years: [...p.years].sort((x, y) => x - y) }])),
  })).sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return { subjects, branches, placements };
}

/** Kept 60 s per server instance - read-only views only. */
export function subjectDepartmentBranches(db: Db, collegeId: string, uid: string, scope: HodDepartmentScope): Promise<SubjectDepartmentBranches> {
  return cachedValue(`subjectDeptBranches/${collegeId}/${uid}`, 60_000, () => load(db, collegeId, scope));
}
