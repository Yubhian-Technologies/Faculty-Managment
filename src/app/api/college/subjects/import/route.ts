export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveDepartmentByNameOrCode, resolveCourseByNameOrCode } from "@/lib/departments/codeOrNameResolver";
import { resolveDepartmentCourseScope, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
import { resolveSubjectCategory, resolveSubjectType } from "@/lib/subjects/normalize";
import type { SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Department/Course/Academic Year/Year are per-row (see csvColumns.ts) so a
// single file can cover multiple departments/courses/years in one go, same
// principle as the student roster importer - each row resolves its own
// context rather than the whole import sharing one picked upfront.
type ImportRow = {
  department?: string;
  course?: string;
  academicYear?: string;
  year?: string;
  serialNumber?: string;
  category?: string;
  customCategory?: string;
  name?: string;
  code?: string;
  regulation?: string;
  type?: string;
  lectureHours?: string;
  tutorialHours?: string;
  practicalHours?: string;
  hoursPerWeek?: string;
  totalHoursPerSemester?: string;
  credits?: string;
};

type DeptDoc = {
  id: string;
  name: string;
  code?: string;
  parentDepartmentId?: string;
  assignedYears?: number[];
  secondaryDepartments?: string[];
  courseScopes?: Record<string, { assignedYears: number[]; secondaryDepartments: string[] }>;
};

type CourseDoc = {
  id: string;
  name: string;
  code?: string;
  departmentId: string;
  durationYears: number;
  catalogId?: string;
  isActive?: boolean;
};

// In-memory re-implementation of resolveSubjectDepartment (src/lib/departments/
// scope.ts) - that helper does its own full `departments` collection fetch on
// every call, which would mean one extra Firestore round trip per row (up to
// 300) here; this runs against the departments already prefetched once for
// the whole import instead.
function resolveSubjectDepartmentLocal(
  departments: DeptDoc[],
  targetDepartmentName: string,
  year: number,
  catalogId: string | undefined | null
): string {
  for (const d of departments) {
    const scope = resolveDepartmentCourseScope(d, catalogId);
    if (scope.secondaryDepartments.includes(targetDepartmentName) && scope.assignedYears.includes(year)) {
      return d.name;
    }
  }
  return targetDepartmentName;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "DEAN");
    const body = (await request.json()) as { records?: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 300) {
      return NextResponse.json({ error: "Maximum 300 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Whole-collection prefetches, once for the entire import, rather than a
    // Firestore round trip per row (up to 300) - same convention as the
    // student roster importer (api/college/students/import-excel/route.ts).
    const [departmentsSnap, coursesSnap, catalogSnap, subjectsSnap, hodScope] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("departments").get(),
      db.collection("colleges").doc(collegeId).collection("courses").get(),
      db.collection("colleges").doc(collegeId).collection("courseCatalog").get(),
      db.collection("colleges").doc(collegeId).collection("subjects").select("courseId", "year", "code").get(),
      session.role === "HOD" ? getHodDepartmentScope(db, collegeId, session.uid) : Promise.resolve(null),
    ]);

    const departments: DeptDoc[] = departmentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeptDoc, "id">) }));
    const courses: CourseDoc[] = coursesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CourseDoc, "id">) }))
      .filter((c) => c.isActive !== false);
    const catalogById = new Map<string, { regulations?: string[]; regulationBatches?: Record<string, string> }>();
    for (const d of catalogSnap.docs) {
      catalogById.set(d.id, d.data() as { regulations?: string[]; regulationBatches?: Record<string, string> });
    }

    const existingCodes = new Set<string>();
    for (const d of subjectsSnap.docs) {
      const s = d.data() as { courseId?: string; year?: number; code?: string };
      if (s.courseId && s.year != null && s.code) existingCodes.add(`${s.courseId}:${s.year}:${s.code.toUpperCase()}`);
    }

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; code: string; error: string }[] = [];
    const warnings: { row: number; code: string; warning: string }[] = [];
    const batch = new ChunkedBatch(db);
    const subjectsColl = db.collection("colleges").doc(collegeId).collection("subjects");

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const codeLabel = row.code?.trim() || "-";

      const dropped = (label: string, raw: string | undefined) => {
        warnings.push({ row: rowNum, code: codeLabel, warning: `${label} ignored - invalid value ("${raw?.trim()}")` });
      };
      const checkNum = (raw: string | undefined, label: string): number | undefined => {
        if (!raw?.trim()) return undefined;
        const n = Number(raw);
        if (!Number.isFinite(n)) { dropped(label, raw); return undefined; }
        return n;
      };
      const requireNum = (raw: string | undefined): number | null => {
        if (!raw?.trim()) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };

      // ── Department ──────────────────────────────────────────────────────
      const deptInput = row.department?.trim();
      if (!deptInput) { failed.push({ row: rowNum, code: codeLabel, error: "Department is required" }); continue; }
      const resolvedDeptName = resolveDepartmentByNameOrCode(departments, deptInput);
      if (!resolvedDeptName) { failed.push({ row: rowNum, code: codeLabel, error: `Department "${deptInput}" not found` }); continue; }
      const requestedDeptDoc = departments.find((d) => d.name === resolvedDeptName)!;

      // ── Course (scoped to the requested department; falls back to a
      // feeder's course cross-listed to it, e.g. Basic Science's shared 1st
      // year offered under CSE) ────────────────────────────────────────────
      const courseInput = row.course?.trim();
      if (!courseInput) { failed.push({ row: rowNum, code: codeLabel, error: "Course is required" }); continue; }
      let course: CourseDoc | undefined;
      const ownCourseName = resolveCourseByNameOrCode(courses, requestedDeptDoc.id, courseInput);
      if (ownCourseName) {
        course = courses.find((c) => c.departmentId === requestedDeptDoc.id && c.name === ownCourseName);
      }
      if (!course) {
        course = courses.find((c) => {
          if (c.departmentId === requestedDeptDoc.id) return false;
          const owningDept = departments.find((d) => d.id === c.departmentId);
          if (!owningDept) return false;
          const scope = resolveDepartmentCourseScope(owningDept, c.catalogId);
          if (!scope.secondaryDepartments.includes(resolvedDeptName)) return false;
          return !!resolveCourseByNameOrCode([c], c.departmentId, courseInput);
        });
      }
      if (!course) { failed.push({ row: rowNum, code: codeLabel, error: `Course "${courseInput}" is not offered by ${resolvedDeptName}` }); continue; }

      // ── Year ─────────────────────────────────────────────────────────────
      const yearNum = requireNum(row.year);
      if (yearNum === null) { failed.push({ row: rowNum, code: codeLabel, error: "Year is required and must be a number" }); continue; }
      if (yearNum < 1 || yearNum > course.durationYears) {
        failed.push({ row: rowNum, code: codeLabel, error: `Year must be between 1 and ${course.durationYears} for ${course.name}` });
        continue;
      }

      // ── Academic Year ────────────────────────────────────────────────────
      const academicYear = row.academicYear?.trim();
      if (!academicYear) { failed.push({ row: rowNum, code: codeLabel, error: "Academic Year is required" }); continue; }

      // ── Resolve the filing department - same rules as the single-create
      // route (api/college/subjects/route.ts POST) ────────────────────────
      let dept = "";
      if (session.role === "HOD") {
        if (!hodScope) { failed.push({ row: rowNum, code: codeLabel, error: "Could not resolve your department scope" }); continue; }
        if (!canHodEditDepartment(hodScope, resolvedDeptName)) {
          failed.push({ row: rowNum, code: codeLabel, error: `"${resolvedDeptName}" is not yours or one of your sub-departments` });
          continue;
        }
        dept = resolvedDeptName;
        const ownsDirectly = requestedDeptDoc.id === course.departmentId;
        const ownsViaParent = !!requestedDeptDoc.parentDepartmentId && requestedDeptDoc.parentDepartmentId === course.departmentId;
        if (!ownsDirectly && !ownsViaParent) {
          failed.push({ row: rowNum, code: codeLabel, error: `"${courseInput}" does not belong to ${resolvedDeptName}` });
          continue;
        }
      } else {
        const courseDept = departments.find((d) => d.id === course!.departmentId);
        const courseDeptName = courseDept?.name ?? "";
        if (resolvedDeptName !== courseDeptName && !(courseDept?.secondaryDepartments ?? []).includes(resolvedDeptName)) {
          failed.push({ row: rowNum, code: codeLabel, error: `"${resolvedDeptName}" doesn't offer this course` });
          continue;
        }
        dept = resolveSubjectDepartmentLocal(departments, resolvedDeptName, yearNum, course.catalogId);
      }

      const scopeDept = departments.find((d) => d.name === dept);
      if (scopeDept) {
        const assignedYears = resolveDepartmentCourseScope(scopeDept, course.catalogId).assignedYears;
        if (assignedYears.length > 0 && !assignedYears.includes(yearNum)) {
          failed.push({ row: rowNum, code: codeLabel, error: `"${dept}" is not assigned to teach Year ${yearNum}` });
          continue;
        }
      }

      // ── Subject fields ───────────────────────────────────────────────────
      if (!row.name?.trim()) { failed.push({ row: rowNum, code: codeLabel, error: "Name of the Subject is required" }); continue; }
      if (!row.code?.trim()) { failed.push({ row: rowNum, code: codeLabel, error: "Code is required" }); continue; }
      const code = row.code.trim().toUpperCase();
      const dedupeKey = `${course.id}:${yearNum}:${code}`;
      if (existingCodes.has(dedupeKey)) { failed.push({ row: rowNum, code, error: "A subject with this code already exists for this course/year" }); continue; }

      if (!row.serialNumber?.trim() || !Number.isFinite(Number(row.serialNumber))) {
        failed.push({ row: rowNum, code, error: "S.No. is required and must be a number" }); continue;
      }
      const serialNumber = Number(row.serialNumber);

      const categoryText = row.category?.trim();
      if (!categoryText) { failed.push({ row: rowNum, code, error: "Category is required" }); continue; }
      const category = resolveSubjectCategory(categoryText);
      if (!category) {
        failed.push({ row: rowNum, code, error: `Unrecognized Category "${categoryText}" - use one of: ${Object.keys(SUBJECT_CATEGORY_LABELS).join(", ")}` });
        continue;
      }
      if (category === "OTHER" && !row.customCategory?.trim()) {
        failed.push({ row: rowNum, code, error: "Custom Category is required when Category is Other" }); continue;
      }

      const lectureHours = requireNum(row.lectureHours);
      const tutorialHours = requireNum(row.tutorialHours);
      const practicalHours = requireNum(row.practicalHours);
      if (lectureHours === null || tutorialHours === null || practicalHours === null) {
        failed.push({ row: rowNum, code, error: "L, T and P are required and must be numbers" }); continue;
      }

      let type: SubjectType = "THEORY";
      const typeText = row.type?.trim();
      if (typeText) {
        const matched = resolveSubjectType(typeText);
        if (matched) {
          type = matched;
        } else {
          warnings.push({ row: rowNum, code, warning: `Type not recognized ("${typeText}") - defaulted to Theory` });
        }
      }

      // ── Regulation - must match what this Department/Course/Year/Academic
      // Year actually resolves to under Course Catalog's batch assignments
      // (regulationsForCourseYearByBatch), not merely be SOME regulation the
      // course has ever been assigned. A course can easily carry two
      // regulations (e.g. R23 covering intakes 2023-2025, R26 covering
      // 2026-2028) - accepting any of them regardless of which one this
      // specific Year+Academic Year actually falls under is exactly how a
      // 2026 intake's 1st Year subject could silently get tagged R23. Left
      // blank, only auto-fills when exactly one regulation resolves
      // (ambiguous cases are left unset, same as the single Add Subject
      // form); when a value IS resolvable and the row's Regulation doesn't
      // match it, the row is rejected rather than silently accepted. Only
      // when NOTHING resolves (no batch data configured at all for this
      // course - the pre-migration case, see regulationsForCourseYearByBatch's
      // own doc-comment) does it fall back to the looser "assigned to the
      // course at all" check, matching the single-create route's original
      // (pre-batch) leniency.
      const catalogData = course.catalogId ? catalogById.get(course.catalogId) : undefined;
      const catalogRegulations = catalogData?.regulations ?? [];
      const resolvedRegulations = regulationsForCourseYearByBatch(
        catalogData?.regulationBatches ?? {},
        yearNum,
        parseAcademicYearStart(academicYear) ?? undefined,
        catalogData?.regulations,
      );
      let regulation = row.regulation?.trim();
      if (!regulation) {
        regulation = resolvedRegulations.length === 1 ? resolvedRegulations[0] : undefined;
      } else if (resolvedRegulations.length > 0) {
        if (!resolvedRegulations.includes(regulation)) {
          failed.push({
            row: rowNum, code,
            error: `Regulation "${regulation}" doesn't match the batch assigned to Year ${yearNum} for ${academicYear} - this year resolves to ${resolvedRegulations.join(", ")}. Check Course Catalog batches.`,
          });
          continue;
        }
      } else if (!catalogRegulations.includes(regulation)) {
        failed.push({ row: rowNum, code, error: `Regulation "${regulation}" isn't assigned to ${course.name}. Check Course Catalog.` });
        continue;
      }

      const hoursPerWeek = checkNum(row.hoursPerWeek, "Hours / Week") ?? 0;
      const totalHoursPerSemester = checkNum(row.totalHoursPerSemester, "Hours / Semester") ?? null;
      const credits = checkNum(row.credits, "Credits") ?? 0;

      const docRef = subjectsColl.doc();
      batch.set(docRef, {
        collegeId,
        department: dept,
        departmentId: course.departmentId,
        courseId: course.id,
        courseName: course.name,
        year: yearNum,
        serialNumber,
        category,
        ...(category === "OTHER" ? { customCategory: row.customCategory!.trim() } : {}),
        name: row.name.trim(),
        code,
        hoursPerWeek,
        totalHoursPerSemester,
        lectureHours,
        tutorialHours,
        practicalHours,
        credits,
        type,
        academicYear,
        ...(regulation ? { regulation } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      existingCodes.add(dedupeKey); // prevent duplicates within the same batch
      created.push(code);
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed, warnings }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
