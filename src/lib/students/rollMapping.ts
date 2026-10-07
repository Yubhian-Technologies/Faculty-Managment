import { normalizeStudentMobile, studentMobileProblem } from "./studentMobile";
import { studentRollKey } from "./loginDefaults";

/**
 * Classifies every row of a "Import Roll Nos" file against the students that
 * already exist, matching on Student Mobile No.
 *
 * Deliberately pure - no Firestore, no I/O. The preview endpoint and the apply
 * endpoint both run THIS function over the same inputs, which is the only way
 * to guarantee the Office is shown what will actually happen. Apply then
 * re-runs it against freshly-read data, because a preview is a snapshot and
 * another Office user may claim a roll in between.
 *
 * Mobile is the match key because it is the one field the admission sheet and
 * the student record reliably share before roll numbers exist - see
 * rosterFields.ts, where Student Mobile No is documented as "how roll numbers
 * are matched to students later". It is NOT enforced unique on write today,
 * so a shared mobile is a real state this has to refuse rather than guess at.
 */

export type RollMapOutcome =
  /** The student exists, has no conflicting roll - apply will set it. */
  | "WILL_SET"
  /** Already holds exactly this roll. Re-running a file lands everything here. */
  | "ALREADY_SET"
  /** Holds a DIFFERENT roll; skipped unless the Office ticks "replace existing". */
  | "DIFFERENT_ROLL"
  /** No student in this college has that mobile. */
  | "NO_MATCH"
  /** Two or more students share that mobile - ambiguous, never guessed. */
  | "MOBILE_SHARED"
  /** Another student holds that roll, in this college or any other. */
  | "ROLL_TAKEN"
  /** The same roll appears on more than one row of the file. Both are skipped. */
  | "DUPLICATE_IN_FILE"
  /** The Roll No cell is empty or has no letters or digits. */
  | "BAD_ROLL"
  /** The Student Mobile No cell is not a usable 10-digit number. */
  | "BAD_MOBILE";

/** Outcomes that write. Everything else is skipped. */
export const APPLIED_OUTCOMES: readonly RollMapOutcome[] = ["WILL_SET"];

export interface RollMapRow {
  /** 1-based row number in the uploaded file, for the results table. */
  rowNumber: number;
  mobile: string;
  roll: string;
  /** Optional, and used ONLY to warn about a mismatch - never to match or write. */
  name?: string;
}

export interface StudentForMapping {
  id: string;
  name?: string;
  rollNumber?: string;
  mobileNo?: string;
}

/** Who holds a roll elsewhere, as resolved from the global registry. */
export interface RollHolderLookup {
  name?: string;
  sameCollege: boolean;
  /** The student that holds it, so "held by the very student we are setting" is not a conflict. */
  studentDocId?: string;
}

export interface ClassifyInput {
  rows: RollMapRow[];
  /** Every student in the caller's own college. */
  students: StudentForMapping[];
  /**
   * The global roll registry, already read for the rolls in this file.
   * Keyed by studentRollKey. Return null when the roll is free.
   */
  rollHolderByKey: Map<string, RollHolderLookup>;
  replaceExisting: boolean;
}

export interface RollMapResult extends RollMapRow {
  outcome: RollMapOutcome;
  /** Normalised forms actually used for matching and writing. */
  mobileNormalized: string;
  rollTrimmed: string;
  studentId?: string;
  studentName?: string;
  currentRoll?: string;
  /** A warning on a row that still applies - never an outcome of its own. */
  nameMismatch?: boolean;
  message: string;
}

const MESSAGES: Record<RollMapOutcome, string> = {
  WILL_SET: "Roll number will be set",
  ALREADY_SET: "Already has this roll number",
  DIFFERENT_ROLL: "Already has a different roll number",
  NO_MATCH: "No student in this college has that mobile number",
  MOBILE_SHARED: "More than one student has that mobile number",
  ROLL_TAKEN: "Another student already holds that roll number",
  DUPLICATE_IN_FILE: "That roll number appears more than once in this file",
  BAD_ROLL: "Roll No is empty or has no letters or digits",
  BAD_MOBILE: "Student Mobile No is not a usable 10-digit number",
};

/** Loose comparison, only for the name-mismatch warning. */
function nameLooksDifferent(fileName: string | undefined, studentName: string | undefined): boolean {
  const a = (fileName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const b = (studentName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!a || !b) return false;
  return a !== b;
}

export function classifyRollMapping(input: ClassifyInput): RollMapResult[] {
  const { rows, students, rollHolderByKey, replaceExisting } = input;

  // Students indexed by their normalised mobile. A mobile held by more than one
  // student is kept as a list so the ambiguity is visible rather than resolved.
  const studentsByMobile = new Map<string, StudentForMapping[]>();
  for (const s of students) {
    const m = normalizeStudentMobile(s.mobileNo);
    if (!m) continue;
    studentsByMobile.set(m, [...(studentsByMobile.get(m) ?? []), s]);
  }

  // Roll keys appearing more than once ACROSS THE FILE. Counted over rows whose
  // roll is usable at all, so two blank cells are two BAD_ROLLs rather than a
  // phantom duplicate.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = studentRollKey(r.roll ?? "");
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicatedInFile = new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  return rows.map((row): RollMapResult => {
    const rollTrimmed = (row.roll ?? "").trim();
    const rollKey = studentRollKey(rollTrimmed);
    const mobileNormalized = normalizeStudentMobile(row.mobile);
    const base = { ...row, mobileNormalized, rollTrimmed };
    const out = (outcome: RollMapOutcome, extra: Partial<RollMapResult> = {}): RollMapResult =>
      ({ ...base, outcome, message: MESSAGES[outcome], ...extra });

    // Unusable cells first - there is nothing to match or write.
    if (!rollKey) return out("BAD_ROLL");
    if (studentMobileProblem(row.mobile)) return out("BAD_MOBILE");

    // A roll repeated in the file is refused on BOTH rows: whichever student is
    // right, applying either would make the file's own meaning depend on order.
    if (duplicatedInFile.has(rollKey)) return out("DUPLICATE_IN_FILE");

    const matches = studentsByMobile.get(mobileNormalized) ?? [];
    if (matches.length === 0) return out("NO_MATCH");
    if (matches.length > 1) {
      return out("MOBILE_SHARED", { studentName: matches.map((m) => m.name ?? m.id).join(", ") });
    }

    const student = matches[0];
    const currentRoll = (student.rollNumber ?? "").trim();
    const nameMismatch = nameLooksDifferent(row.name, student.name);
    const matched = { studentId: student.id, studentName: student.name, currentRoll, nameMismatch };

    // Already this student's roll - idempotent, and the reason re-running a
    // file is safe. Checked BEFORE the registry, since the registry naturally
    // reports this student as the holder.
    if (studentRollKey(currentRoll) === rollKey) return out("ALREADY_SET", matched);

    // Held by somebody else, here or in another college. Checked BEFORE
    // DIFFERENT_ROLL: when both are true the roll is unavailable either way,
    // and that is the more useful thing to tell the Office.
    const holder = rollHolderByKey.get(rollKey);
    if (holder && holder.studentDocId !== student.id) {
      return out("ROLL_TAKEN", {
        ...matched,
        message: holder.sameCollege && holder.name
          ? `Roll number already held by ${holder.name}`
          : holder.sameCollege
            ? MESSAGES.ROLL_TAKEN
            : "Roll number already held by a student in another college",
      });
    }

    // Has some other roll already. Replacing is a deliberate, opt-in act.
    if (currentRoll && !replaceExisting) return out("DIFFERENT_ROLL", matched);

    return out("WILL_SET", matched);
  });
}

/** Counts per outcome, for the preview summary. */
export function summarizeRollMapping(results: RollMapResult[]): Record<RollMapOutcome, number> {
  const counts = Object.fromEntries(
    (Object.keys(MESSAGES) as RollMapOutcome[]).map((k) => [k, 0])
  ) as Record<RollMapOutcome, number>;
  for (const r of results) counts[r.outcome]++;
  return counts;
}
