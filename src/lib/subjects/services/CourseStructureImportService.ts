import { getAdminDb } from "@/lib/firebase/admin";
import { MasterSubjectImportService } from "./MasterSubjectImportService";
import { SubjectInstanceService } from "./SubjectInstanceService";
import type { SubjectRowInput } from "../validation/SubjectValidator";

// Combines what used to be two separate manual steps (Add Subject, then
// Assign to Semester) into one upload for Academics > Course Structure.
// Deliberately its own service rather than a method on
// MasterSubjectImportService - that class's whole dedupe model is
// course+regulation, department-independent by design (see its own
// doc-comment), and never takes a departmentId. This wraps it for the
// create step, then loops SubjectInstanceService.assignSubjectInstance per
// successfully-created row using THAT ROW'S OWN year/semester (not one
// fixed semester for the whole batch, so bulkAssignSubjectInstances isn't
// reusable as-is).
export interface CourseStructureImportPayload {
  collegeId: string;
  // The SELECTED DEPARTMENT's own Course doc id (not necessarily the
  // catalog's "first" course doc - see the course-resolution fix in
  // academics/assign-semester/page.tsx's selectedCourse for why that
  // distinction matters for a department fed by a shared-year manager).
  courseId: string;
  departmentId: string;
  departmentName?: string;
  regulation?: string;
  academicYear?: string;
  records: SubjectRowInput[];
}

export interface CourseStructureImportResult {
  created: number;
  assigned: number;
  failed: { row: number; code: string; error: string; stage: "create" | "assign" }[];
  warnings: { row: number; code: string; warning: string }[];
}

export class CourseStructureImportService {
  constructor(private db = getAdminDb()) {}

  public async executeImport(payload: CourseStructureImportPayload): Promise<CourseStructureImportResult> {
    const { collegeId, courseId, departmentId, departmentName, regulation, academicYear, records } = payload;

    const masterImporter = new MasterSubjectImportService(this.db);
    const createResult = await masterImporter.executeImport({
      collegeId,
      courseId,
      regulation,
      academicYear,
      records,
      requireYearSemester: true,
    });

    const failed: CourseStructureImportResult["failed"] = createResult.failed.map((f) => ({ ...f, stage: "create" as const }));
    const warnings = createResult.warnings;

    const instanceService = new SubjectInstanceService(this.db);
    // Shared across every row, same reasoning as bulkAssignSubjectInstances'
    // own yearCache - every row here resolves against the same courseId.
    const yearCache = new Map<string, number | null>();
    let assigned = 0;

    for (const row of createResult.createdRows) {
      if (row.year == null || row.semester == null) {
        // Shouldn't happen - requireYearSemester rejects a row missing
        // either before it's ever created (see SubjectCatalogValidator) -
        // guarded anyway rather than assigning with an undefined semester.
        failed.push({ row: row.row, code: row.code, error: "Missing Year/Semester after creation", stage: "assign" });
        continue;
      }
      // Explicit pre-check against Course-Year Timings, rather than relying
      // on assignSubjectInstance's own resolution: that method silently
      // TRUSTS a caller-supplied year when no timing doc covers the
      // semester at all (a leniency that made sense for its other callers,
      // whose year only ever came from a dropdown itself populated from
      // real timing data - see that method's own doc-comment). Here, Year/
      // Semester come from an arbitrary XLSX cell, not a constrained
      // dropdown, so that fallback would silently create an assignment for
      // a Year/Semester nobody ever configured. Checking first and failing
      // with an explicit "not configured" message keeps this flow strict
      // without touching assignSubjectInstance's existing behavior for its
      // other (dropdown-driven) callers.
      const yearCacheKey = `${courseId}:${row.year ?? ""}:${row.semester}`;
      const resolvedYear = yearCache.has(yearCacheKey)
        ? yearCache.get(yearCacheKey)!
        : await instanceService.resolveYearForSemester(collegeId, courseId, row.semester, row.year);
      // Populate the same cache assignSubjectInstance itself consults below
      // (identical key format - see its own doc-comment), so its internal
      // lookup for this exact row is a cache hit, not a second Firestore read.
      yearCache.set(yearCacheKey, resolvedYear);

      if (resolvedYear == null) {
        failed.push({
          row: row.row,
          code: row.code,
          error: `Year ${row.year} / Semester ${row.semester} isn't configured in Course-Year Timings for this course - set it up first, then re-import this row.`,
          stage: "assign",
        });
        continue;
      }
      if (resolvedYear !== row.year) {
        failed.push({
          row: row.row,
          code: row.code,
          error: `Semester ${row.semester} belongs to Year ${resolvedYear} for this course, not Year ${row.year} - check Course-Year Timings.`,
          stage: "assign",
        });
        continue;
      }

      try {
        await instanceService.assignSubjectInstance(
          {
            collegeId,
            subjectId: row.subjectId,
            departmentId,
            semester: row.semester,
            departmentName,
            year: row.year,
            courseId,
          },
          yearCache
        );
        assigned++;
      } catch (err) {
        failed.push({
          row: row.row,
          code: row.code,
          error: err instanceof Error ? err.message : "Assignment failed",
          stage: "assign",
        });
      }
    }

    return { created: createResult.created, assigned, failed, warnings };
  }
}
