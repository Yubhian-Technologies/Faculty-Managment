import { rollNumberUpperOf } from "@/lib/students/loginDefaults";

// Giving students a mentor by typing roll numbers (like assigning subjects by code): paste them, check
// them, then assign. Pure - the route reads the students and hands them in.

export const ROLL_ASSIGN_MAX = 200;

/** Roll numbers from pasted text (one per line, or separated by commas / spaces), upper-cased, repeats dropped. */
export function parseRollNumbers(text: string): { rolls: string[]; repeated: number } {
  const seen = new Set<string>();
  const rolls: string[] = [];
  let repeated = 0;
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    const roll = rollNumberUpperOf(part);
    if (!roll) continue;
    if (seen.has(roll)) { repeated++; continue; }
    seen.add(roll);
    rolls.push(roll);
  }
  return { rolls, repeated };
}

export type RollStatus = "ASSIGN" | "ALREADY_MENTEE" | "HAS_OTHER_MENTOR" | "NOT_FOUND" | "OUTSIDE_DEPARTMENT" | "GRADUATED";

/** Only these stop an assignment; ASSIGN and ALREADY_MENTEE are fine. */
export const ROLL_PROBLEMS: readonly RollStatus[] = ["HAS_OTHER_MENTOR", "NOT_FOUND", "OUTSIDE_DEPARTMENT", "GRADUATED"];

export interface RollPlanItem {
  roll: string;
  status: RollStatus;
  studentId?: string;
  name?: string;
  section?: string;
  year?: number;
  message?: string;
}

export interface RollStudent {
  id: string;
  name?: string;
  section?: string;
  year?: number;
  status?: string;
  mentorUid?: string;
  mentorName?: string;
}

/** What one roll number comes to, for the mentor being assigned. `manageable` = the HOD manages this student. */
export function classifyRoll(roll: string, student: RollStudent | undefined, mentorUid: string, manageable: boolean): RollPlanItem {
  if (!student) return { roll, status: "NOT_FOUND", message: "No student with this roll number in the college." };
  const base = { roll, studentId: student.id, name: student.name ?? "", section: student.section ?? "", year: student.year };
  // A student of another department is not named - the HOD only learns that the roll is not theirs.
  if (!manageable) return { roll, status: "OUTSIDE_DEPARTMENT", message: "Not a student of your department." };
  if (student.status === "GRADUATED") return { ...base, status: "GRADUATED", message: "Already graduated." };
  if (student.mentorUid === mentorUid) return { ...base, status: "ALREADY_MENTEE", message: "Already with this mentor - left as it is." };
  if (student.mentorUid) {
    return { ...base, status: "HAS_OTHER_MENTOR", message: `Already mentored by ${student.mentorName || "another faculty member"} - remove that mentor first.` };
  }
  return { ...base, status: "ASSIGN" };
}

export function summarizeRollPlan(plan: RollPlanItem[]) {
  return {
    toAssign: plan.filter((p) => p.status === "ASSIGN").length,
    alreadyMentee: plan.filter((p) => p.status === "ALREADY_MENTEE").length,
    problems: plan.filter((p) => ROLL_PROBLEMS.includes(p.status)).length,
  };
}
