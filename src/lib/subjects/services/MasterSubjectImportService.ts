import { getAdminDb } from "@/lib/firebase/admin";
import { SubjectCatalogValidator, type SubjectRowInput } from "../validation/SubjectValidator";
import type { Subject } from "@/types";

export interface MasterImportPayload {
  collegeId: string;
  courseId?: string;
  courseName?: string;
  academicYear?: string;
  regulation?: string;
  records: SubjectRowInput[];
}

export interface MasterImportResult {
  created: number;
  failed: { row: number; code: string; error: string }[];
  warnings: { row: number; code: string; warning: string }[];
}

export class MasterSubjectImportService {
  constructor(private db = getAdminDb()) {}

  public async executeImport(payload: MasterImportPayload): Promise<MasterImportResult> {
    const { collegeId, records } = payload;
    const collegeRef = this.db.collection("colleges").doc(collegeId);

    // 1. Fetch active courses
    const coursesSnap = await collegeRef.collection("courses").get();
    const courses = coursesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { name: string; code?: string; catalogId?: string; isActive?: boolean }) }))
      .filter((c) => c.isActive !== false);

    // 2. Fetch catalog items for regulation verification
    const catalogSnap = await collegeRef.collection("courseCatalog").get();
    const catalogById = new Map<string, { regulations?: string[]; regulationBatches?: Record<string, string> }>();
    for (const d of catalogSnap.docs) {
      catalogById.set(d.id, d.data() as { regulations?: string[]; regulationBatches?: Record<string, string> });
    }

    // 3. Track existing subject codes in this college to prevent duplicate insertions
    const subjectsSnap = await collegeRef.collection("subjects").select("courseId", "regulation", "code").get();
    const existingCodes = new Set<string>();
    for (const d of subjectsSnap.docs) {
      const s = d.data() as { courseId?: string; regulation?: string; code?: string };
      if (s.courseId && s.code) {
        const regKey = (s.regulation ?? "").trim();
        existingCodes.add(`${s.courseId}:${regKey}:${s.code.toUpperCase()}`);
      }
    }

    const failed: MasterImportResult["failed"] = [];
    const warnings: MasterImportResult["warnings"] = [];
    const subjectsToCreate: Array<Omit<Subject, "id"> & { id?: string }> = [];
    const now = new Date();

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const codeLabel = row.code?.toString().trim() || "-";

      // ── Resolve Course ────────────────────────────────────────────────────
      const courseInput = row.course?.toString().trim() || payload.courseName?.trim();
      let matchingCourse = payload.courseId ? courses.find((c) => c.id === payload.courseId) : undefined;
      if (!matchingCourse && courseInput) {
        matchingCourse = courses.find(
          (c) =>
            c.name.toLowerCase() === courseInput.toLowerCase() ||
            (c.code && c.code.toLowerCase() === courseInput.toLowerCase())
        );
      }
      if (!matchingCourse) {
        failed.push({ row: rowNum, code: codeLabel, error: "Course is required" });
        continue;
      }
      const course = matchingCourse;

      // ── Resolve Academic Year ─────────────────────────────────────────────
      const academicYear = row.academicYear?.toString().trim() || payload.academicYear?.trim();
      if (!academicYear) {
        failed.push({ row: rowNum, code: codeLabel, error: "Academic Year is required" });
        continue;
      }

      // ── Validate Row with SubjectCatalogValidator ─────────────────────────
      const validation = SubjectCatalogValidator.validateRow(row, {
        regulation: payload.regulation,
        academicYear,
      });

      if (validation.warnings.length > 0) {
        for (const w of validation.warnings) {
          warnings.push({ row: rowNum, code: codeLabel, warning: w });
        }
      }

      if (!validation.isValid || !validation.data) {
        failed.push({
          row: rowNum,
          code: codeLabel,
          error: validation.errors.join("; "),
        });
        continue;
      }

      const validData = validation.data;

      // ── Resolve & Validate Regulation ─────────────────────────────────────
      const catalogData = course.catalogId ? catalogById.get(course.catalogId) : undefined;
      const catalogRegulations = catalogData?.regulations ?? [];
      let regulation = validData.regulation?.trim() || payload.regulation?.trim();

      if (!regulation) {
        if (catalogRegulations.length === 1) {
          regulation = catalogRegulations[0];
        } else if (catalogRegulations.length > 1) {
          failed.push({
            row: rowNum,
            code: validData.code,
            error: `Multiple regulations available for ${course.name} (${catalogRegulations.join(
              ", "
            )}) - select a regulation or specify in Regulation column`,
          });
          continue;
        }
      } else {
        if (catalogRegulations.length > 0 && !catalogRegulations.includes(regulation)) {
          failed.push({
            row: rowNum,
            code: validData.code,
            error: `Regulation "${regulation}" is not assigned to ${course.name}. Available: ${catalogRegulations.join(
              ", "
            )}`,
          });
          continue;
        }
      }

      // ── Deduplication Check ───────────────────────────────────────────────
      const dedupeKey = `${course.id}:${(regulation ?? "").trim()}:${validData.code}`;
      if (existingCodes.has(dedupeKey)) {
        failed.push({
          row: rowNum,
          code: validData.code,
          error: "A subject with this code already exists for this course and regulation",
        });
        continue;
      }

      existingCodes.add(dedupeKey);

      subjectsToCreate.push({
        collegeId,
        courseId: course.id,
        courseName: course.name,
        academicYear,
        ...(regulation ? { regulation } : {}),
        serialNumber: validData.serialNumber,
        category: validData.category,
        ...(validData.customCategory ? { customCategory: validData.customCategory } : {}),
        name: validData.name,
        code: validData.code,
        ...(validData.shortCode ? { shortCode: validData.shortCode } : {}),
        hoursPerWeek: validData.hoursPerWeek,
        ...(validData.totalHoursPerSemester != null ? { totalHoursPerSemester: validData.totalHoursPerSemester } : {}),
        lectureHours: validData.lectureHours,
        tutorialHours: validData.tutorialHours,
        practicalHours: validData.practicalHours,
        credits: validData.credits,
        type: validData.type,
        isActive: true,
        createdAt: now as unknown as Subject["createdAt"],
        updatedAt: now as unknown as Subject["updatedAt"],
      });
    }

    // ── Batch Persist to colleges/{id}/subjects ───────────────────────────
    if (subjectsToCreate.length > 0) {
      const BATCH_SIZE = 400;
      for (let i = 0; i < subjectsToCreate.length; i += BATCH_SIZE) {
        const chunk = subjectsToCreate.slice(i, i + BATCH_SIZE);
        const batch = this.db.batch();
        for (const item of chunk) {
          const docRef = collegeRef.collection("subjects").doc();
          batch.set(docRef, item);
        }
        await batch.commit();
      }
    }

    return {
      created: subjectsToCreate.length,
      failed,
      warnings,
    };
  }
}
