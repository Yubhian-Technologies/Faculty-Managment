export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
import { resolveSubjectCategory, resolveSubjectType } from "@/lib/subjects/normalize";
import type { SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Bulk import creates MASTER SUBJECTS (courseId + regulation + academicYear)
// without requiring department/year. Each row specifies: course, regulation,
// academicYear, and all subject fields (name, code, category, L/T/P, etc).
type ImportRow = {
  course?: string;
  regulation?: string;
  academicYear?: string;
  serialNumber?: string;
  category?: string;
  customCategory?: string;
  name?: string;
  code?: string;
  type?: string;
  lectureHours?: string;
  tutorialHours?: string;
  practicalHours?: string;
  hoursPerWeek?: string;
  totalHoursPerSemester?: string;
  credits?: string;
};

type ImportResult = {
  created: number;
  failed: { row: number; code: string; error: string }[];
  warnings: { row: number; code: string; warning: string }[];
};

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await request.json()) as { records?: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 300) {
      return NextResponse.json({ error: "Maximum 300 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const collegeRef = db.collection("colleges").doc(collegeId);

    // Fetch courses once for the entire import
    const coursesSnap = await collegeRef.collection("courses").get();
    const courses = coursesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { name: string; code?: string; catalogId?: string; isActive?: boolean }) }))
      .filter((c) => c.isActive !== false);

    // Fetch catalog items for regulation resolution
    const catalogSnap = await collegeRef.collection("courseCatalog").get();
    const catalogById = new Map<string, { regulations?: string[]; regulationBatches?: Record<string, string> }>();
    for (const d of catalogSnap.docs) {
      catalogById.set(d.id, d.data() as { regulations?: string[]; regulationBatches?: Record<string, string> });
    }

    // Track existing codes to prevent duplicates
    const subjectsSnap = await collegeRef.collection("subjects").select("courseId", "regulation", "code").get();
    const existingCodes = new Set<string>();
    for (const d of subjectsSnap.docs) {
      const s = d.data() as { courseId?: string; regulation?: string; code?: string };
      if (s.courseId && s.regulation && s.code) {
        existingCodes.add(`${s.courseId}:${s.regulation}:${s.code.toUpperCase()}`);
      }
    }

    const created: string[] = [];
    const failed: { row: number; code: string; error: string }[] = [];
    const warnings: { row: number; code: string; warning: string }[] = [];
    const now = new Date();

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const codeLabel = row.code?.trim() || "-";

      // ── Course ───────────────────────────────────────────────────────────
      const courseInput = row.course?.trim();
      if (!courseInput) {
        failed.push({ row: rowNum, code: codeLabel, error: "Course is required" });
        continue;
      }
      // Find course by name or code across all departments
      const matchingCourse = courses.find((c) => 
        c.name.toLowerCase() === courseInput.toLowerCase() || 
        (c.code && c.code.toLowerCase() === courseInput.toLowerCase())
      );
      if (!matchingCourse) {
        failed.push({ row: rowNum, code: codeLabel, error: `Course "${courseInput}" not found` });
        continue;
      }
      const course = matchingCourse;

      // ── Academic Year ────────────────────────────────────────────────────
      const academicYear = row.academicYear?.trim();
      if (!academicYear) {
        failed.push({ row: rowNum, code: codeLabel, error: "Academic Year is required" });
        continue;
      }

      // ── Subject fields ───────────────────────────────────────────────────
      if (!row.name?.trim()) {
        failed.push({ row: rowNum, code: codeLabel, error: "Name of the Subject is required" });
        continue;
      }
      if (!row.code?.trim()) {
        failed.push({ row: rowNum, code: codeLabel, error: "Code is required" });
        continue;
      }
      const code = row.code.trim().toUpperCase();

      if (!row.serialNumber?.trim() || !Number.isFinite(Number(row.serialNumber))) {
        failed.push({ row: rowNum, code, error: "S.No. is required and must be a number" });
        continue;
      }
      const serialNumber = Number(row.serialNumber);

      const categoryText = row.category?.trim();
      if (!categoryText) {
        failed.push({ row: rowNum, code, error: "Category is required" });
        continue;
      }
      const category = resolveSubjectCategory(categoryText);
      if (!category) {
        failed.push({
          row: rowNum,
          code,
          error: `Unrecognized Category "${categoryText}" - use one of: ${Object.keys(SUBJECT_CATEGORY_LABELS).join(", ")}`,
        });
        continue;
      }
      if (category === "OTHER" && !row.customCategory?.trim()) {
        failed.push({ row: rowNum, code, error: "Custom Category is required when Category is Other" });
        continue;
      }

      const lectureHours = row.lectureHours ? Number(row.lectureHours) : undefined;
      const tutorialHours = row.tutorialHours ? Number(row.tutorialHours) : undefined;
      const practicalHours = row.practicalHours ? Number(row.practicalHours) : undefined;
      if (lectureHours == null || tutorialHours == null || practicalHours == null) {
        failed.push({ row: rowNum, code, error: "L, T and P are required and must be numbers" });
        continue;
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

      // ── Regulation - resolve from catalog batch data ────────────────────
      const catalogData = course.catalogId ? catalogById.get(course.catalogId) : undefined;
      const catalogRegulations = catalogData?.regulations ?? [];
      let regulation = row.regulation?.trim();

      if (!regulation) {
        // Auto-resolve if only one regulation available
        if (catalogRegulations.length === 1) {
          regulation = catalogRegulations[0];
        } else if (catalogRegulations.length > 1) {
          failed.push({
            row: rowNum,
            code,
            error: `Multiple regulations available for ${course.name} (${catalogRegulations.join(", ")}) - specify which one in the Regulation column`,
          });
          continue;
        }
        // else: no regulations, leave empty
      } else {
        // Validate the provided regulation
        if (catalogRegulations.length > 0 && !catalogRegulations.includes(regulation)) {
          failed.push({
            row: rowNum,
            code,
            error: `Regulation "${regulation}" is not assigned to ${course.name}. Available: ${catalogRegulations.join(", ")}`,
          });
          continue;
        }
      }

      // ── Duplicate check ──────────────────────────────────────────────────
      const dedupeKey = `${course.id}:${regulation}:${code}`;
      if (existingCodes.has(dedupeKey)) {
        failed.push({ row: rowNum, code, error: "A subject with this code already exists for this course/regulation" });
        continue;
      }

      const hoursPerWeek = row.hoursPerWeek ? Number(row.hoursPerWeek) : 0;
      const totalHoursPerSemester = row.totalHoursPerSemester ? Number(row.totalHoursPerSemester) : null;
      const credits = row.credits ? Number(row.credits) : 0;

      // ── Create master subject ────────────────────────────────────────────
      const docRef = collegeRef.collection("subjects").doc();
      await docRef.set({
        collegeId,
        courseId: course.id,
        courseName: course.name,
        academicYear,
        regulation: regulation || undefined,
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
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      existingCodes.add(dedupeKey);
      created.push(code);
    }

    return NextResponse.json({ created: created.length, failed, warnings }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
