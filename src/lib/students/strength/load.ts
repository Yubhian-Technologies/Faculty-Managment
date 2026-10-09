import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { Course } from "@/types";
import { managerEffectiveYears } from "@/lib/departments/hodScope";
import { buildStrengthCube, groupedBranchNames, type CatalogCourse, type CatalogDepartment, type CatalogSection } from "./aggregate";
import { normKey } from "./config";
import { filterRowsForHod } from "./hodScope";
import type { StrengthPayload, StrengthRow } from "./types";

// Firestore has no GROUP BY, and the one rule that makes a shared-first-year
// student count under their REAL branch (secondaryDepartment, else department -
// see effectiveBranchName) can't be phrased as equality-only COUNT() queries:
// it needs "field is absent" and range clauses, i.e. composite indexes that
// have to be deployed by hand (a missing one is a 500 in production - the
// exact failure students/paginatedList.ts documents).
//
// So the database does the reading and the server does the GROUP BY, in one
// streamed pass over a 10-field PROJECTION of each student (never the full
// document, never sent to the browser). Only the aggregated cube leaves this
// function. One pass also means one consistent snapshot: every table on the
// dashboard is built from the same instant, so they can't disagree with each
// other. A COUNT() aggregation runs alongside as an independent integrity
// check on the number of records scanned.

const PROJECTION = [
  "name",
  "rollNumber",
  "department",
  "secondaryDepartment",
  "course",
  "courseId",
  "year",
  "section",
  "status",
  "batch",
] as const;

export async function scanStudentRows(studentsColl: FirebaseFirestore.CollectionReference): Promise<StrengthRow[]> {
  const rows: StrengthRow[] = [];
  const stream = studentsColl.select(...PROJECTION).stream() as AsyncIterable<QueryDocumentSnapshot>;
  for await (const doc of stream) {
    const d = doc.data() as Omit<StrengthRow, "id">;
    rows.push({
      id: doc.id,
      name: d.name,
      rollNumber: d.rollNumber,
      department: d.department,
      secondaryDepartment: d.secondaryDepartment,
      course: d.course,
      courseId: d.courseId,
      year: d.year,
      section: d.section,
      status: d.status,
      batch: d.batch,
    });
  }
  return rows;
}

export interface LoadStrengthOptions {
  /** Present for an HOD: the roster-visibility scope to apply before counting. */
  hodScope?: HodDepartmentScope;
}

export async function loadStrengthPayload(
  db: Firestore,
  collegeId: string,
  opts: LoadStrengthOptions = {}
): Promise<StrengthPayload> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const studentsColl = collegeRef.collection("students");

  const [rowsAll, deptsSnap, coursesSnap, sectionsSnap, collegeSnap, session, countSnap] = await Promise.all([
    scanStudentRows(studentsColl),
    collegeRef.collection("departments").get(),
    collegeRef.collection("courses").get(),
    collegeRef.collection("sections").get(),
    collegeRef.get(),
    resolveCollegeAcademicYear(db, collegeId).catch(() => ""),
    // DB-side aggregation: an independent count of the same collection.
    studentsColl.count().get(),
  ]);

  const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (CatalogDepartment & DepartmentYearRow)[];
  const courseDocs = coursesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (CatalogCourse & Course)[];
  let sections = sectionsSnap.docs.map((d) => d.data()) as CatalogSection[];

  const rows = opts.hodScope ? filterRowsForHod(rowsAll, opts.hodScope, departments, courseDocs) : rowsAll;

  // An HOD may only learn about sections they actually own. Section docs are
  // scoped BEFORE anything is built (not filtered out of the result after), so
  // another department's section names can't reach the response through any
  // field - the section list, the section dropdown or the label map. Each
  // section is tested with the very rule that admits students: a section is
  // visible when a student filed under its department, in its year and course,
  // would be (e.g. a branch's first-year sections belong to the shared-year
  // manager, its second-year sections to the branch's own HOD).
  if (opts.hodScope) {
    const courseNameById = new Map(courseDocs.map((c) => [c.id, c.name]));
    const probes: StrengthRow[] = sections.map((s, i) => ({
      id: String(i),
      department: s.department,
      year: s.year,
      course: (s.courseId ? courseNameById.get(s.courseId) : undefined) ?? s.courseName,
    }));
    const allowed = new Set(filterRowsForHod(probes, opts.hodScope, departments, courseDocs).map((r) => r.id));
    sections = sections.filter((_, i) => allowed.has(String(i)));
  }

  const { cells, meta, health } = buildStrengthCube(rows, { courses: courseDocs, departments, sections });

  // An HOD only ever sees their own scope, so configured-but-empty departments
  // of the rest of the college must not appear (or leak) in their tables.
  if (opts.hodScope) {
    const scope = opts.hodScope;
    const ownNames = [...scope.ownDepartmentNames, ...scope.childDepartmentNames];
    const ownDepts = departments.filter((d) => ownNames.includes((d.name ?? "").trim()));
    // The branches these departments hold a shared year FOR - their core
    // departments - listed even with nobody in them yet, so the Department
    // filter offers every branch the department is configured for rather than
    // only the ones that happen to have students today. Read from both fields
    // a college may configure them in: BASIC SCIENCE - ENGLISH cross-lists to
    // CSE [CYBER SECURITY] and COMPUTER SCIENCE AND ENGINEERING, and only the
    // second had students, so the first never appeared.
    const coreNames = ownDepts.flatMap(groupedBranchNames);
    const visible = new Set([
      ...cells.map((c) => c.branch),
      ...[...ownNames, ...scope.managedDepartmentNames, ...coreNames].map(normKey),
    ]);
    meta.branches = meta.branches.filter((b) => visible.has(b.key));
    for (const p of meta.programs) p.branchKeys = p.branchKeys.filter((k) => visible.has(k));
    // ...and only programs they have students in or run a department under.
    const programsWithCells = new Set(cells.map((c) => c.program));
    meta.programs = meta.programs.filter((p) => programsWithCells.has(p.key) || p.branchKeys.length > 0);

    // The years these departments are configured to teach, PER PROGRAM - what
    // the Year filter may offer. managerEffectiveYears is the same rule the
    // rest of the app scopes years by (own Years Taught, else the parent's,
    // minus any year fed to another department), resolved against the catalog
    // entry of the course in question. Per program because one department
    // commonly runs several with different years.
    const byProgram: Record<string, number[]> = {};
    const catalogsByProgram = new Map<string, Set<string>>();
    for (const c of courseDocs) {
      const key = normKey(c.name ?? "");
      if (!key || !c.catalogId) continue;
      const set = catalogsByProgram.get(key) ?? new Set<string>();
      set.add(c.catalogId);
      catalogsByProgram.set(key, set);
    }
    for (const p of meta.programs) {
      const years = new Set<number>();
      for (const d of ownDepts) {
        for (const catalogId of catalogsByProgram.get(p.key) ?? [undefined]) {
          for (const y of managerEffectiveYears(d as never, departments as never, catalogId)) years.add(y);
        }
      }
      if (years.size > 0) byProgram[p.key] = [...years].sort((a, b) => a - b);
    }
    if (Object.keys(byProgram).length > 0) meta.scopeYearsByProgram = byProgram;
  }

  return {
    generatedAt: new Date().toISOString(),
    collegeName: (collegeSnap.data() as { name?: string } | undefined)?.name ?? "",
    session,
    scope: opts.hodScope ? "department" : "college",
    meta,
    cells,
    health,
    integrity: opts.hodScope ? null : { databaseCount: countSnap.data().count, scannedRecords: rowsAll.length },
  };
}
