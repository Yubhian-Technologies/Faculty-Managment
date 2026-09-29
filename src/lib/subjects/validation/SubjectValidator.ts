import { SUBJECT_CATEGORY_LABELS, type SubjectCategory, type SubjectType } from "@/types";
import { resolveSubjectCategory, resolveSubjectType } from "@/lib/subjects/normalize";

export interface SubjectRowInput {
  serialNumber?: string | number;
  category?: string;
  customCategory?: string;
  name?: string;
  code?: string;
  shortCode?: string;
  type?: string;
  lectureHours?: string | number;
  tutorialHours?: string | number;
  practicalHours?: string | number;
  hoursPerWeek?: string | number;
  totalHoursPerSemester?: string | number;
  credits?: string | number;
  course?: string;
  regulation?: string;
  academicYear?: string;
  // Course Structure upload only (see CourseStructureImportService) - which
  // department-semester this row also gets auto-assigned to, on top of
  // being created as a master subject. Required only when the caller's
  // contextDefaults.requireYearSemester is set - every other caller
  // (single Add Subject, the plain course+regulation bulk import) leaves
  // department/year/semester assignment as a separate manual step, same
  // as before.
  year?: string | number;
  semester?: string | number;
  // Reference-only exam metadata - see Subject.internalMarks's own
  // doc-comment (types/teaching.ts). Never validated against anything.
  internalMarks?: string | number;
  externalMarks?: string | number;
  totalMarks?: string | number;
}

export interface ValidatedSubjectRow {
  name: string;
  code: string;
  shortCode?: string;
  serialNumber: number;
  category: SubjectCategory;
  customCategory?: string;
  type: SubjectType;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  hoursPerWeek: number;
  totalHoursPerSemester: number | null;
  credits: number;
  regulation?: string;
  academicYear?: string;
  year?: number;
  semester?: number;
  internalMarks?: number;
  externalMarks?: number;
  totalMarks?: number;
}

export interface SubjectRowValidationResult {
  isValid: boolean;
  data?: ValidatedSubjectRow;
  errors: string[];
  warnings: string[];
}

export class SubjectCatalogValidator {
  public static validateRow(
    row: SubjectRowInput,
    contextDefaults?: { regulation?: string; academicYear?: string; requireYearSemester?: boolean }
  ): SubjectRowValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Name
    const name = row.name?.toString().trim();
    if (!name) {
      errors.push("Name of the Subject is required");
    }

    // 2. Code
    const rawCode = row.code?.toString().trim();
    if (!rawCode) {
      errors.push("Code is required");
    }
    const code = rawCode ? rawCode.toUpperCase() : "";

    // 2b. Short Code - optional, same casing convention as Code, no length/format
    // gate (colleges vary: "CHE", "CH", "CHM" are all legitimate mnemonics).
    const shortCode = row.shortCode?.toString().trim().toUpperCase() || undefined;

    // 3. Serial Number
    const rawSNo = row.serialNumber?.toString().trim();
    const serialNumber = Number(rawSNo);
    if (!rawSNo || !Number.isFinite(serialNumber) || serialNumber <= 0) {
      errors.push("S.No. is required and must be a positive number");
    }

    // 4. Category
    const categoryText = row.category?.toString().trim();
    let category: SubjectCategory | undefined;
    if (!categoryText) {
      errors.push("Category is required");
    } else {
      category = resolveSubjectCategory(categoryText);
      if (!category) {
        errors.push("Category is required");
      } else if (!Object.keys(SUBJECT_CATEGORY_LABELS).includes(category) && category !== "OTHER") {
        warnings.push(`New category "${category}" will be added to the curriculum`);
      }
    }

    const customCategory = row.customCategory?.toString().trim();
    if (category === "OTHER" && !customCategory) {
      errors.push("Custom Category is required when Category is Other");
    }

    // 5. L, T, P contact hours
    const rawL = row.lectureHours?.toString().trim();
    const rawT = row.tutorialHours?.toString().trim();
    const rawP = row.practicalHours?.toString().trim();

    if (rawL == null || rawL === "" || rawT == null || rawT === "" || rawP == null || rawP === "") {
      errors.push("L, T and P are required and must be numbers");
    }

    const lectureHours = Number(rawL ?? 0);
    const tutorialHours = Number(rawT ?? 0);
    const practicalHours = Number(rawP ?? 0);

    if (isNaN(lectureHours) || lectureHours < 0) {
      errors.push("Lecture hours (L) must be a non-negative number");
    }
    if (isNaN(tutorialHours) || tutorialHours < 0) {
      errors.push("Tutorial hours (T) must be a non-negative number");
    }
    if (isNaN(practicalHours) || practicalHours < 0) {
      errors.push("Practical hours (P) must be a non-negative number");
    }

    // 6. Type
    let type: SubjectType = "THEORY";
    const typeText = row.type?.toString().trim();
    if (typeText) {
      const matched = resolveSubjectType(typeText);
      if (matched) {
        type = matched;
      } else if (practicalHours > 0 && lectureHours === 0) {
        type = "PRACTICAL";
        warnings.push(`Type "${typeText}" not recognized - defaulted to Practical based on practical hours (P=${practicalHours})`);
      } else {
        warnings.push(`Type not recognized ("${typeText}") - defaulted to Theory`);
      }
    } else if (practicalHours > 0 && lectureHours === 0) {
      type = "PRACTICAL";
    }

    // 7. Hours Per Week, Total Hours, Credits
    const computedHoursPerWeek = lectureHours + tutorialHours + practicalHours;
    const hoursPerWeek = row.hoursPerWeek != null && row.hoursPerWeek !== ""
      ? Number(row.hoursPerWeek)
      : computedHoursPerWeek;

    const totalHoursPerSemester = row.totalHoursPerSemester != null && row.totalHoursPerSemester !== ""
      ? Number(row.totalHoursPerSemester)
      : null;

    const credits = row.credits != null && row.credits !== ""
      ? Number(row.credits)
      : Math.round((lectureHours + tutorialHours + practicalHours * 0.5) * 10) / 10;

    const regulation = row.regulation?.toString().trim() || contextDefaults?.regulation;
    const academicYear = row.academicYear?.toString().trim() || contextDefaults?.academicYear;

    // 8. Year / Semester - required only for the Course Structure flow
    // (contextDefaults.requireYearSemester), which auto-assigns each row
    // into a department's semester on top of creating the master subject.
    // Every other caller leaves this as a separate manual step, so these
    // stay optional there (undefined, not validated).
    let year: number | undefined;
    let semester: number | undefined;
    if (contextDefaults?.requireYearSemester) {
      const rawYear = row.year?.toString().trim();
      const rawSemester = row.semester?.toString().trim();
      year = Number(rawYear);
      semester = Number(rawSemester);
      if (!rawYear || !Number.isFinite(year) || year <= 0) {
        errors.push("Year is required and must be a positive number");
      }
      if (!rawSemester || !Number.isFinite(semester) || semester <= 0) {
        errors.push("Semester is required and must be a positive number");
      }
    }

    // 9. Marks - reference-only, no validation beyond "is it a number".
    const internalMarks = row.internalMarks != null && row.internalMarks !== "" ? Number(row.internalMarks) : undefined;
    const externalMarks = row.externalMarks != null && row.externalMarks !== "" ? Number(row.externalMarks) : undefined;
    const totalMarks = row.totalMarks != null && row.totalMarks !== "" ? Number(row.totalMarks) : undefined;

    if (errors.length > 0) {
      return { isValid: false, errors, warnings };
    }

    return {
      isValid: true,
      data: {
        name: name!,
        code,
        shortCode,
        serialNumber,
        category: category!,
        customCategory: category === "OTHER" ? customCategory : undefined,
        type,
        lectureHours,
        tutorialHours,
        practicalHours,
        hoursPerWeek: isNaN(hoursPerWeek) ? computedHoursPerWeek : hoursPerWeek,
        totalHoursPerSemester,
        credits: isNaN(credits) ? 0 : credits,
        regulation,
        academicYear,
        year,
        semester,
        internalMarks: internalMarks != null && !isNaN(internalMarks) ? internalMarks : undefined,
        externalMarks: externalMarks != null && !isNaN(externalMarks) ? externalMarks : undefined,
        totalMarks: totalMarks != null && !isNaN(totalMarks) ? totalMarks : undefined,
      },
      errors: [],
      warnings,
    };
  }
}
