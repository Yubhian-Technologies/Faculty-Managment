import type { MidBankRules, Subject, SubjectOutcomes } from "@/types";
import { midUnitsFor } from "./unitSplit";

// What still stands between an assignment and its question bank. Each issue
// says who resolves it, so a faculty member is never left with a bare error.

export interface SetupIssue { code: "NO_RULES" | "NO_MID_IN_RULES" | "NO_OUTCOMES" | "UNITS_MISSING" | "MAPPING_MISSING"; message: string; who: "EXAM_CELL" | "FACULTY" }

export function setupIssues(
  subject: Pick<Subject, "courseName" | "regulation">,
  midNumber: number,
  rules: MidBankRules | null,
  outcomes: Pick<SubjectOutcomes, "units"> & Partial<Pick<SubjectOutcomes, "cos" | "mapping">> | null,
  /** The Exam Cell's units exception for this subject, if any. */
  exception?: Record<string, number[]> | null,
): { issues: SetupIssue[]; units: number[]; unitSource: ReturnType<typeof midUnitsFor>["source"] } {
  const issues: SetupIssue[] = [];
  const course = `${subject.courseName ?? "this course"}${subject.regulation ? ` (${subject.regulation})` : ""}`;
  // The subject's own unit count picks the split (5 units: 1-3 / 3-5, 6 units: 1-3 / 4-6 ...).
  const { units, source: unitSource } = midUnitsFor(rules, midNumber, outcomes?.units.length || null, exception);
  if (!rules && unitSource !== "SUBJECT") issues.push({ code: "NO_RULES", who: "EXAM_CELL", message: `The Exam Cell hasn't set the Mid question bank rules for ${course} yet (Exam Cell > Settings).` });
  else if (units.length === 0) issues.push({ code: "NO_MID_IN_RULES", who: "EXAM_CELL", message: `The Exam Cell's rules for ${course} don't say which units Mid ${midNumber} covers${outcomes ? ` for a subject of ${outcomes.units.length} units` : ""}.` });
  if (!outcomes) issues.push({ code: "NO_OUTCOMES", who: "FACULTY", message: "Enter the units and Course Outcomes, then the CO-PO/PSO mapping." });
  else {
    const have = new Set(outcomes.units.map((u) => u.no));
    const missing = units.filter((u) => !have.has(u));
    if (missing.length > 0) issues.push({ code: "UNITS_MISSING", who: unitSource === "DEFAULT" ? "EXAM_CELL" : "FACULTY", message: unitSource === "DEFAULT"
      ? `Mid ${midNumber} covers Unit ${missing.join(", ")}, but this subject has ${outcomes.units.length} units - ask the Exam Cell to set the Mid units for ${outcomes.units.length}-unit subjects (Mid Configuration), or check the number of units.`
      : `Mid ${midNumber} covers Unit ${missing.join(", ")}, which the setup doesn't have yet - add the unit(s).` });
    const unmapped = (outcomes.cos ?? []).filter((c) => (outcomes.mapping?.[c.id] ?? []).length === 0).map((c) => c.id);
    if (unmapped.length > 0) issues.push({ code: "MAPPING_MISSING", who: "FACULTY", message: `Map ${unmapped.join(", ")} to at least one PO or PSO (CO-PO Mapping).` });
  }
  return { issues, units, unitSource };
}
