import { getAdminDb } from "@/lib/firebase/admin";
import { SubjectCatalogValidator, type SubjectRowInput } from "../validation/SubjectValidator";
import type { Subject } from "@/types";

export interface MasterImportPayload {
  collegeId: string;
  courseId?: string;
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
    if (!payload.courseId) {
      // The shipped importer (academics/subjects/import/page.tsx) always
      // sends the selected course's id explicitly. Without this, a caller
      // that only sends a course NAME would get matched below by free-text
      // name/code across the WHOLE college - and since every department
      // legitimately clones the same Course Catalog entry into its own
      // Course doc with an identical name (see courses/route.ts POST), that
      // match is ambiguous by construction and can silently bind subjects to
      // the wrong department's course. Reject up front instead of guessing.
      return { created: 0, failed: [{ row: 0, code: "-", error: "Select a Course before importing" }], warnings: [] };
    }
    const collegeRef = this.db.collection("colleges").doc(collegeId);

    // 1. Fetch active courses
    const coursesSnap = await collegeRef.collection("courses").get();
    const courses = coursesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { name: string; code?: string; catalogId?: string; isActive?: boolean }) }))
      .filter((c) => c.isActive !== false);
    // courseId -> the shared key its duplicate-detection group is keyed by.
    // Master subjects are department-independent (visible to every
    // department teaching this catalog course - see /api/college/subjects
    // GET's own doc-comment), so two departments' separate Course docs for
    // the SAME catalog course must dedupe against each other, not just
    // within their own courseId - otherwise Basic Science and CSE could
    // both import "R231101" and end up with two subjects sharing that code
    // in the one Master Collection they both now see. Falls back to the
    // courseId itself only for a legacy Course doc with no catalogId, which
    // has no sibling to collide with anyway.
    const groupKeyByCourseId = new Map<string, string>(courses.map((c) => [c.id, c.catalogId || c.id]));

    // 2. Fetch catalog items for regulation verification
    const catalogSnap = await collegeRef.collection("courseCatalog").get();
    const catalogById = new Map<string, { regulations?: string[]; regulationBatches?: Record<string, string> }>();
    for (const d of catalogSnap.docs) {
      catalogById.set(d.id, d.data() as { regulations?: string[]; regulationBatches?: Record<string, string> });
    }

    // 3. Track existing subject codes across every department sharing this
    // catalog course, to prevent duplicate insertions from any of them.
    const subjectsSnap = await collegeRef.collection("subjects").select("courseId", "regulation", "code").get();
    const existingCodes = new Set<string>();
    for (const d of subjectsSnap.docs) {
      const s = d.data() as { courseId?: string; regulation?: string; code?: string };
      if (s.courseId && s.code) {
        const regKey = (s.regulation ?? "").trim();
        const groupKey = groupKeyByCourseId.get(s.courseId) ?? s.courseId;
        existingCodes.add(`${groupKey}:${regKey}:${s.code.toUpperCase()}`);
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
      // courseId is required (checked above) and always the specific
      // department-owned Course doc the caller selected - never resolved
      // from a free-typed name/code, which would be ambiguous whenever more
      // than one department has cloned the same Course Catalog entry (see
      // courses/route.ts POST; this is the normal, expected shape, not an
      // edge case).
      const course = courses.find((c) => c.id === payload.courseId);
      if (!course) {
        failed.push({ row: rowNum, code: codeLabel, error: "Course is required" });
        continue;
      }

      // ── Resolve Academic Year (optional) ──────────────────────────────────
      const academicYear = row.academicYear?.toString().trim() || payload.academicYear?.trim() || undefined;

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
        } else {
          // No regulations configured for this course at all - importing
          // without one is allowed (same leniency every other regulation
          // check in this codebase falls back to), but unlike the branches
          // above this produces no signal at all otherwise, so the import
          // result looks like a clean success with regulation silently
          // dropped.
          warnings.push({
            row: rowNum,
            code: validData.code,
            warning: `${course.name} has no regulations configured - imported without a regulation tag`,
          });
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
      const dedupeGroupKey = groupKeyByCourseId.get(course.id) ?? course.id;
      const dedupeKey = `${dedupeGroupKey}:${(regulation ?? "").trim()}:${validData.code}`;
      if (existingCodes.has(dedupeKey)) {
        failed.push({
          row: rowNum,
          code: validData.code,
          error: "A subject with this code already exists for this course and regulation (possibly under another department teaching the same course)",
        });
        continue;
      }

      existingCodes.add(dedupeKey);

      subjectsToCreate.push({
        collegeId,
        courseId: course.id,
        courseName: course.name,
        ...(academicYear ? { academicYear } : {}),
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
