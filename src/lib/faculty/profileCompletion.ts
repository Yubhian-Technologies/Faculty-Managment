// Faculty Profile Completion Rate - how much of a faculty member's own
// profile (Identity & Employment, Personal Details, Academic Qualification,
// Professional Experience, Research & Innovation, Professional Development,
// Financial Standing, Others) is actually filled in, section by section.
//
// Deliberately reuses the already-vetted field catalogue (EXPORT_FIELDS,
// grouped by EXPORT_MODULE_ORDER) and buildRow's flattening from
// exportFacultyCsv.ts - a field "counts" exactly when the export would show a
// non-blank cell for it, so this can never drift from what the full-detail
// export already treats as filled. "Teaching Load" is excluded: it's
// assigned by HOD/Timetable, not filled in by the faculty member themselves.
import { EXPORT_FIELDS, EXPORT_MODULE_ORDER, EXPORT_MODULE_LABELS, type ExportModuleKey } from "@/lib/faculty/csvColumns";
import { buildRow } from "@/lib/faculty/exportFacultyCsv";
import type { FacultyMember } from "@/types";

export type CompletionModuleKey = Exclude<ExportModuleKey, "teaching-load">;

export const COMPLETION_MODULE_ORDER: CompletionModuleKey[] =
  EXPORT_MODULE_ORDER.filter((m): m is CompletionModuleKey => m !== "teaching-load");

const FIELDS_BY_MODULE: Record<CompletionModuleKey, typeof EXPORT_FIELDS> = Object.fromEntries(
  COMPLETION_MODULE_ORDER.map((key) => [key, EXPORT_FIELDS.filter((f) => f.module === key)])
) as Record<CompletionModuleKey, typeof EXPORT_FIELDS>;

export interface SectionCompletion {
  key: CompletionModuleKey;
  label: string;
  filledCount: number;
  totalCount: number;
  percent: number; // 0-100, rounded
  isComplete: boolean;
}

export interface FacultyProfileCompletion {
  overallPercent: number;
  filledCount: number;
  totalCount: number;
  sections: SectionCompletion[];
}

function percentOf(filled: number, total: number): number {
  return total === 0 ? 100 : Math.round((filled / total) * 100);
}

export function computeFacultyProfileCompletion(faculty: FacultyMember): FacultyProfileCompletion {
  // Teaching Load isn't part of completion, so the summary string is never read.
  const row = buildRow(faculty, "");
  const sections: SectionCompletion[] = COMPLETION_MODULE_ORDER.map((key) => {
    const fields = FIELDS_BY_MODULE[key];
    const filledCount = fields.filter((f) => (row[f.key] ?? "").trim() !== "").length;
    const totalCount = fields.length;
    return {
      key,
      label: EXPORT_MODULE_LABELS[key],
      filledCount,
      totalCount,
      percent: percentOf(filledCount, totalCount),
      isComplete: totalCount > 0 && filledCount === totalCount,
    };
  });
  const filledCount = sections.reduce((sum, s) => sum + s.filledCount, 0);
  const totalCount = sections.reduce((sum, s) => sum + s.totalCount, 0);
  return { overallPercent: percentOf(filledCount, totalCount), filledCount, totalCount, sections };
}
