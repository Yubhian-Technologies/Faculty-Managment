import { SUBJECT_CATEGORY_LABELS, type SubjectCategory, type SubjectType } from "@/types";
import { resolveSubjectCategory, resolveSubjectType } from "@/lib/subjects/normalize";
import { normalizeSubjectCode, normalizeUniversityCode } from "@/lib/subjects/subjectIdentity";

// The one rulebook for a master subject's own fields (single add, bulk import).
// Nothing is invented: a missing credit value is an error, not "L + T + P/2",
// and an unreadable number is an error, not 0 - credits feed SGPA.

export interface SubjectRowInput {
  category?: string;
  customCategory?: string;
  name?: string;
  code?: string;
  shortCode?: string;
  universityCode?: string;
  type?: string;
  lectureHours?: string | number;
  tutorialHours?: string | number;
  practicalHours?: string | number;
  totalHoursPerSemester?: string | number;
  credits?: string | number;
  regulation?: string;
  // Reference-only exam metadata - see Subject.internalMarks's doc-comment (types/teaching.ts).
  internalMarks?: string | number;
  externalMarks?: string | number;
  totalMarks?: string | number;
  /** "Don't include in teaching load" - stored as isNonTeachingLoad + excludeFromResume. */
  excludeFromTeachingLoad?: boolean;
}

export interface ValidatedSubjectRow {
  name: string;
  code: string;
  shortCode?: string;
  universityCode?: string;
  category: SubjectCategory;
  customCategory?: string;
  type: SubjectType;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  /** Always L + T + P - never taken from the input. */
  hoursPerWeek: number;
  totalHoursPerSemester: number | null;
  credits: number;
  regulation?: string;
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

export const SUBJECT_LIMITS = {
  weeklyHours: 40,
  credits: 30,
  semesterHours: 400,
  marks: 1000,
  codeLength: 30,
  nameLength: 200,
} as const;

type Parsed = { blank: true } | { blank: false; value: number } | { invalid: true };

function parseNumber(raw: unknown): Parsed {
  if (raw == null) return { blank: true };
  const text = String(raw).trim();
  if (text === "") return { blank: true };
  // An explicit dash / "NC" is how a sheet says "none" (a zero-credit course, no practical hours).
  if (/^(-|–|—|nc)$/i.test(text)) return { blank: false, value: 0 };
  const n = Number(text);
  return Number.isFinite(n) ? { blank: false, value: n } : { invalid: true };
}

export class SubjectCatalogValidator {
  public static validateRow(row: SubjectRowInput, contextDefaults?: { regulation?: string }): SubjectRowValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = row.name?.toString().replace(/\s+/g, " ").trim();
    if (!name) errors.push("Name of the Subject is required");
    else if (name.length > SUBJECT_LIMITS.nameLength) errors.push(`Name is longer than ${SUBJECT_LIMITS.nameLength} characters`);

    const code = normalizeSubjectCode(row.code);
    if (!code) errors.push("Code is required");
    else if (code.length > SUBJECT_LIMITS.codeLength) errors.push(`Code is longer than ${SUBJECT_LIMITS.codeLength} characters`);
    else if (/[\s/\\]/.test(code)) errors.push("Code must not contain spaces or slashes");

    const shortCode = row.shortCode?.toString().trim().toUpperCase() || undefined;
    const universityCode = normalizeUniversityCode(row.universityCode) || undefined;

    const categoryText = row.category?.toString().trim();
    let category: SubjectCategory | undefined;
    if (!categoryText) {
      errors.push("Category is required");
    } else {
      category = resolveSubjectCategory(categoryText);
      if (!category) errors.push("Category is required");
      else if (!Object.keys(SUBJECT_CATEGORY_LABELS).includes(category) && category !== "OTHER") {
        warnings.push(`New category "${category}" will be added to the curriculum`);
      }
    }
    const customCategory = row.customCategory?.toString().trim();
    if (category === "OTHER" && !customCategory) errors.push("Custom Category is required when Category is Other");

    const hours = (label: string, raw: unknown): number => {
      const p = parseNumber(raw);
      if ("invalid" in p) { errors.push(`${label} must be a number`); return 0; }
      if (p.blank) { errors.push(`${label} is required (enter 0 if none)`); return 0; }
      if (p.value < 0 || p.value > SUBJECT_LIMITS.weeklyHours) { errors.push(`${label} must be between 0 and ${SUBJECT_LIMITS.weeklyHours}`); return 0; }
      return p.value;
    };
    const lectureHours = hours("Lecture hours (L)", row.lectureHours);
    const tutorialHours = hours("Tutorial hours (T)", row.tutorialHours);
    const practicalHours = hours("Practical hours (P)", row.practicalHours);

    // Type: blank is derived from the hours (a lab-only subject is Practical); a value that
    // names no known type is an error rather than a silent Theory.
    let type: SubjectType = lectureHours + tutorialHours === 0 && practicalHours > 0 ? "PRACTICAL" : "THEORY";
    const typeText = row.type?.toString().trim();
    if (typeText) {
      const matched = resolveSubjectType(typeText);
      if (matched) type = matched;
      else errors.push(`Type "${typeText}" is not recognised (Theory, Practical, Tutorial, Project or Non-teaching)`);
    }

    const creditsParsed = parseNumber(row.credits);
    let credits = 0;
    if ("invalid" in creditsParsed) errors.push("Credits must be a number");
    else if (creditsParsed.blank) errors.push("Credits are required (enter 0 for a zero-credit subject)");
    else if (creditsParsed.value < 0 || creditsParsed.value > SUBJECT_LIMITS.credits) errors.push(`Credits must be between 0 and ${SUBJECT_LIMITS.credits}`);
    else credits = creditsParsed.value;

    const totalParsed = parseNumber(row.totalHoursPerSemester);
    let totalHoursPerSemester: number | null = null;
    if ("invalid" in totalParsed) errors.push("Total hours per semester must be a number");
    else if (!totalParsed.blank) {
      if (totalParsed.value < 0 || totalParsed.value > SUBJECT_LIMITS.semesterHours) errors.push(`Total hours per semester must be between 0 and ${SUBJECT_LIMITS.semesterHours}`);
      else totalHoursPerSemester = totalParsed.value;
    }

    const marks = (label: string, raw: unknown): number | undefined => {
      const p = parseNumber(raw);
      if ("invalid" in p) { errors.push(`${label} must be a number`); return undefined; }
      if (p.blank) return undefined;
      if (p.value < 0 || p.value > SUBJECT_LIMITS.marks) { errors.push(`${label} must be between 0 and ${SUBJECT_LIMITS.marks}`); return undefined; }
      return p.value;
    };
    const internalMarks = marks("Internal marks", row.internalMarks);
    const externalMarks = marks("External marks", row.externalMarks);
    const totalMarks = marks("Total marks", row.totalMarks);

    const regulation = row.regulation?.toString().trim() || contextDefaults?.regulation?.trim() || undefined;

    if (errors.length > 0) return { isValid: false, errors, warnings };

    return {
      isValid: true,
      data: {
        name: name!,
        code,
        shortCode,
        universityCode,
        category: category!,
        customCategory: category === "OTHER" ? customCategory : undefined,
        type,
        lectureHours,
        tutorialHours,
        practicalHours,
        hoursPerWeek: lectureHours + tutorialHours + practicalHours,
        totalHoursPerSemester,
        credits,
        regulation,
        internalMarks,
        externalMarks,
        totalMarks,
      },
      errors: [],
      warnings,
    };
  }
}
