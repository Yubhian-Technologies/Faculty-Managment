import { buildMatrix, type ParsedGrid } from "@/lib/timetable/import/gridTypes";
import { validatePlacement } from "@/lib/timetable/draftPlacement";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { TimetableContext } from "@/lib/timetable/loadContext";
import type { CourseYearTiming, DayOfWeek, DraftSlot, TeachingAssignment } from "@/types";

const DAY_PREFIXES: [DayOfWeek, string][] = [
  ["MON", "mon"], ["TUE", "tue"], ["WED", "wed"], ["THU", "thu"], ["FRI", "fri"], ["SAT", "sat"],
];

function matchDay(text: string): DayOfWeek | null {
  const norm = text.trim().toLowerCase();
  if (!norm) return null;
  for (const [day, prefix] of DAY_PREFIXES) {
    if (norm.startsWith(prefix)) return day;
  }
  return null;
}

function matchPeriod(text: string, timing: CourseYearTiming): number | null {
  const norm = text.trim();
  if (!norm) return null;

  // A clock-time header ("9:00-9:50") is tried FIRST and, when present,
  // exclusively - a bare number pulled from inside a time (e.g. the "9" in
  // "9:00") must never be misread as a literal period number, which the
  // college's own numberOfPeriods range check alone can't always catch (a
  // 9+ period day would let it slip through as a false match).
  const timeMatch = /(\d{1,2})[:.](\d{2})\s*(am|pm)?/i.exec(norm);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const targetMinutes = hour * 60 + minute;
    const source = timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);
    for (const p of source) {
      const [ph, pm] = p.startTime.split(":").map(Number);
      const periodMinutes = ph * 60 + pm;
      // A bare "9:00" with no AM/PM is compared both as-is and shifted 12h,
      // so a 24-hour-configured afternoon period (e.g. 14:00) still matches
      // a header that only wrote "2:00" without a meridiem marker.
      if (Math.abs(periodMinutes - targetMinutes) <= 10) return p.period;
      if (!meridiem && Math.abs(periodMinutes - ((targetMinutes + 12 * 60) % (24 * 60))) <= 10) return p.period;
    }
    return null;
  }

  // No clock-time pattern at all - safe to read a plain period number out of
  // labels like "P1", "Period 1", "Per. 1", or a bare "1".
  const numMatch = /^\D*(\d{1,2})\b/.exec(norm);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (n >= 1 && n <= timing.numberOfPeriods) return n;
  }
  return null;
}

/**
 * Splits one cell's free text into a (subject, faculty) token pair. Tries
 * increasingly loose delimiters and stops at the first one that yields
 * exactly two non-empty pieces - a cell that doesn't cleanly split any of
 * these ways comes back null (ambiguous), never a guess.
 */
export function splitCellTokens(raw: string): { a: string; b: string } | null {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 2) return { a: lines[0], b: lines[1] };
  if (lines.length > 2) return null;

  const single = lines[0] ?? raw.trim();
  if (!single) return null;

  const paren = /^(.*)\(([^()]+)\)\s*$/.exec(single);
  if (paren && paren[1].trim() && paren[2].trim()) {
    return { a: paren[1].trim(), b: paren[2].trim() };
  }

  const slashParts = single.split("/").map((p) => p.trim()).filter(Boolean);
  if (slashParts.length === 2) return { a: slashParts[0], b: slashParts[1] };

  // Only a dash with surrounding spaces counts as a delimiter, so a bare
  // subject code like "CS-201" (no spaces around the dash) isn't split apart.
  const dashParts = single.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (dashParts.length === 2) return { a: dashParts[0], b: dashParts[1] };

  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesSubject(token: string, a: TeachingAssignment): boolean {
  const norm = normalize(token);
  if (!norm) return false;
  const code = normalize(a.subjectCode);
  const shortCode = normalize(a.shortCode ?? "");
  const name = normalize(a.subjectName);
  return (
    norm === code || norm === shortCode || norm === name ||
    (code.length > 0 && (code.includes(norm) || norm.includes(code))) ||
    (shortCode.length > 0 && (shortCode.includes(norm) || norm.includes(shortCode))) ||
    (name.length > 0 && (name.includes(norm) || norm.includes(name)))
  );
}

function matchesFaculty(token: string, a: TeachingAssignment): boolean {
  const norm = normalize(token);
  if (!norm) return false;
  const faculty = normalize(a.facultyName);
  if (!faculty) return false;
  if (norm === faculty || faculty.includes(norm) || norm.includes(faculty)) return true;
  // Loose surname match, e.g. token "Dr Rao" vs faculty "Ramesh Rao".
  const tokenWords = norm.split(" ").filter(Boolean);
  const facultyWords = faculty.split(" ").filter(Boolean);
  return tokenWords.length > 0 && facultyWords.length > 0
    && tokenWords[tokenWords.length - 1] === facultyWords[facultyWords.length - 1];
}

/**
 * Resolves a cell's two free-text tokens against this section's real teaching
 * assignments. Tokens can appear in either order ("CS201 / Dr. Rao" or
 * "Dr. Rao / CS201"), so both orders are tried; only an assignment that
 * matches one token as the subject AND the other as the faculty in some
 * consistent order counts as a candidate. Zero or multiple candidates are
 * reported back to the caller rather than guessed.
 */
export function resolveCandidates(tokens: { a: string; b: string }, assignments: TeachingAssignment[]): TeachingAssignment[] {
  const forward = assignments.filter((x) => matchesSubject(tokens.a, x) && matchesFaculty(tokens.b, x));
  const reverse = assignments.filter((x) => matchesSubject(tokens.b, x) && matchesFaculty(tokens.a, x));
  const byId = new Map<string, TeachingAssignment>();
  for (const a of [...forward, ...reverse]) byId.set(a.id, a);
  return Array.from(byId.values());
}

export type ImportCellStatus = "matched" | "unmatched" | "ambiguous" | "conflict" | "unparsed";

export interface ImportPlacement {
  day: DayOfWeek;
  startPeriod: number;
  blockSize: number;
  rawText: string;
  status: ImportCellStatus;
  assignmentId?: string;
  subjectId?: string;
  subjectName?: string;
  facultyId?: string;
  facultyName?: string;
  candidates?: { assignmentId: string; subjectName: string; facultyName: string }[];
  error?: string;
}

/**
 * Detects grid orientation, splits and fuzzy-matches every data cell, and
 * hard-constraint-validates each match against `existingSlots` PLUS whatever
 * this same pass has already accepted - so two cells in the same uploaded
 * document that conflict with each other (e.g. the same faculty double-
 * booked twice) are caught exactly like a conflict against a real draft.
 */
export function matchTimetableGrid(
  grid: ParsedGrid,
  ctx: TimetableContext,
  existingSlots: DraftSlot[],
): { placements: ImportPlacement[] } | { error: string } {
  const { timing } = ctx;
  if (!timing) return { error: "No period timing is configured for this course year." };
  if (grid.rowCount < 2 || grid.colCount < 2) {
    return { error: "This document doesn't contain a usable timetable grid." };
  }

  const matrix = buildMatrix(grid);
  const headerRow = Array.from({ length: grid.colCount }, (_, c) => matrix[0]?.[c]?.text ?? "");
  const headerCol = Array.from({ length: grid.rowCount }, (_, r) => matrix[r]?.[0]?.text ?? "");

  const rowDayCount = new Set(headerRow.map(matchDay).filter((d): d is DayOfWeek => d !== null)).size;
  const colDayCount = new Set(headerCol.map(matchDay).filter((d): d is DayOfWeek => d !== null)).size;

  if (rowDayCount < 3 && colDayCount < 3) {
    return {
      error: "Could not find the days of the week in the table's first row or first column. "
        + "Make sure day labels (Monday, Tuesday, ...) are clearly in a header row or column.",
    };
  }
  const daysInRow = rowDayCount >= colDayCount;

  const dayByIndex = new Map<number, DayOfWeek>();
  const periodByIndex = new Map<number, number>();
  if (daysInRow) {
    for (let c = 1; c < grid.colCount; c++) {
      const day = matchDay(headerRow[c]);
      if (day) dayByIndex.set(c, day);
    }
    for (let r = 1; r < grid.rowCount; r++) {
      const period = matchPeriod(headerCol[r], timing);
      if (period) periodByIndex.set(r, period);
    }
  } else {
    for (let r = 1; r < grid.rowCount; r++) {
      const day = matchDay(headerCol[r]);
      if (day) dayByIndex.set(r, day);
    }
    for (let c = 1; c < grid.colCount; c++) {
      const period = matchPeriod(headerRow[c], timing);
      if (period) periodByIndex.set(c, period);
    }
  }

  const placements: ImportPlacement[] = [];
  const workingSlots: DraftSlot[] = [...existingSlots];
  const assignments = ctx.assignments.filter((a) => !a.isPast);
  const seen = new Set<string>();

  for (const dIdx of dayByIndex.keys()) {
    for (const pIdx of periodByIndex.keys()) {
      const [row, col] = daysInRow ? [pIdx, dIdx] : [dIdx, pIdx];
      const cell = matrix[row]?.[col];
      if (!cell) continue;
      const key = `${cell.row}:${cell.col}`;
      if (seen.has(key)) continue; // a merged cell covers more than one (dIdx,pIdx) combo
      seen.add(key);

      const text = cell.text.trim();
      if (!text) continue;

      const day = dayByIndex.get(dIdx)!;
      const startPeriod = periodByIndex.get(pIdx)!;
      const periodSpan = daysInRow ? cell.rowSpan : cell.colSpan;
      const daySpan = daysInRow ? cell.colSpan : cell.rowSpan;

      if (daySpan > 1) {
        placements.push({
          day, startPeriod, blockSize: periodSpan, rawText: text, status: "unparsed",
          error: "This cell spans more than one day - split it into one cell per day.",
        });
        continue;
      }

      const tokens = splitCellTokens(text);
      if (!tokens) {
        placements.push({
          day, startPeriod, blockSize: periodSpan, rawText: text, status: "unparsed",
          error: "Could not split this cell into a subject and a faculty name.",
        });
        continue;
      }

      const candidates = resolveCandidates(tokens, assignments);
      if (candidates.length === 0) {
        placements.push({
          day, startPeriod, blockSize: periodSpan, rawText: text, status: "unmatched",
          error: "No teaching assignment on this section matches this subject and faculty.",
        });
        continue;
      }
      if (candidates.length > 1) {
        placements.push({
          day, startPeriod, blockSize: periodSpan, rawText: text, status: "ambiguous",
          error: "More than one teaching assignment matches this cell.",
          candidates: candidates.map((c) => ({ assignmentId: c.id, subjectName: c.subjectName, facultyName: c.facultyName })),
        });
        continue;
      }

      const assignment = candidates[0];
      const subject = ctx.subjectsById.get(assignment.subjectId);
      // Only a lab (PRACTICAL) subject's document-visible span becomes a
      // multi-period block - a theory subject's cell is never forced across
      // periods just because it happened to be merged in the source file.
      const blockSize = subject?.type === "PRACTICAL" ? periodSpan : 1;

      const placementProblem = validatePlacement(ctx, { slots: workingSlots }, {
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
        subjectId: assignment.subjectId,
        day,
        startPeriod,
        blockSize,
        ignore: new Set<string>(),
      });

      if (placementProblem) {
        placements.push({
          day, startPeriod, blockSize, rawText: text, status: "conflict", error: placementProblem,
          assignmentId: assignment.id, subjectId: assignment.subjectId, subjectName: assignment.subjectName,
          facultyId: assignment.facultyId, facultyName: assignment.facultyName,
        });
        continue;
      }

      for (let i = 0; i < blockSize; i++) {
        workingSlots.push({
          assignmentId: assignment.id, facultyId: assignment.facultyId, facultyName: assignment.facultyName,
          subjectId: assignment.subjectId, subjectName: assignment.subjectName, subjectType: subject?.type ?? "THEORY",
          day, periodNumber: startPeriod + i, isBlockContinuation: i > 0,
        });
      }

      placements.push({
        day, startPeriod, blockSize, rawText: text, status: "matched",
        assignmentId: assignment.id, subjectId: assignment.subjectId, subjectName: assignment.subjectName,
        facultyId: assignment.facultyId, facultyName: assignment.facultyName,
      });
    }
  }

  return { placements };
}
