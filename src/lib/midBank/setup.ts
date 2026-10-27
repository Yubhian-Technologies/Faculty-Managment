import type { MidBankRules, Subject, SubjectOutcomes } from "@/types";

// What still stands between an assignment and its question bank. Each issue
// says who resolves it, so a faculty member is never left with a bare error.

export interface SetupIssue { code: "NO_RULES" | "NO_MID_IN_RULES" | "NO_OUTCOMES" | "UNITS_MISSING"; message: string; who: "EXAM_CELL" | "FACULTY" }

export function setupIssues(
  subject: Pick<Subject, "courseName" | "regulation">,
  midNumber: number,
  rules: MidBankRules | null,
  outcomes: Pick<SubjectOutcomes, "units"> | null
): { issues: SetupIssue[]; units: number[] } {
  const issues: SetupIssue[] = [];
  const course = `${subject.courseName ?? "this course"}${subject.regulation ? ` (${subject.regulation})` : ""}`;
  const units = rules?.mids[String(midNumber)] ?? [];
  if (!rules) issues.push({ code: "NO_RULES", who: "EXAM_CELL", message: `The Exam Cell hasn't set the Mid question bank rules for ${course} yet (Exam Cell > Settings).` });
  else if (units.length === 0) issues.push({ code: "NO_MID_IN_RULES", who: "EXAM_CELL", message: `The Exam Cell's rules for ${course} don't say which units Mid ${midNumber} covers.` });
  if (!outcomes) issues.push({ code: "NO_OUTCOMES", who: "FACULTY", message: "Enter the subject's units, Course Outcomes and CO-PO/PSO mapping below." });
  else {
    const have = new Set(outcomes.units.map((u) => u.no));
    const missing = units.filter((u) => !have.has(u));
    if (missing.length > 0) issues.push({ code: "UNITS_MISSING", who: "FACULTY", message: `Mid ${midNumber} covers Unit ${missing.join(", ")}, which the setup doesn't have yet - add the unit(s).` });
  }
  return { issues, units };
}
