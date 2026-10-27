// Parses the "past student attendance" sheet: one section per sheet, Regd. No down the side, one column per
// calendar date, P or A in each cell. Client-safe (no server imports) so the page can validate before sending.
//
//   Regd. No | Name (optional) | 11-Aug-2026 | 12-Aug-2026 | ...
//   22A91A0501 | ...          | P           | A           | ...
//
// Also reads the college's paper-register layout: title rows above the header, S.No / Name columns, date headers
// that give the full date only at the start (29-8-2026, 31-8-2026, 1-9-26) and a bare day number after that (2, 3,
// 5 ... 29) with the month implied by position, then CC / AC / "% of Attendance" summary columns and a footer
// (REGISTRAR, a date) under the last student.
//
// A blank cell (or "-") means "no record for that student that day": the student is left out of that day's
// sessions, they are neither counted present nor absent.

export type ImportMark = "PRESENT" | "ABSENT";

export interface PastAttendanceGrid {
  dates: string[]; // YYYY-MM-DD, in column order
  students: { roll: string; marks: (ImportMark | null)[] }[]; // marks[i] belongs to dates[i]
  errors: string[]; // stop the import
  warnings: string[]; // shown, but do not stop it (e.g. the register's own total disagrees with its P marks)
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** A header cell as a YYYY-MM-DD date, or null. Day-first for numeric dates; "11-Aug" takes `defaultYear`. */
export function parseDateHeader(raw: string, defaultYear: number): string | null {
  const h = raw.trim();
  let m = h.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = h.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return validDate(fullYear(+m[3]), +m[2], +m[1]);
  m = h.match(/^(\d{1,2})[\s/.-]*([A-Za-z]{3,9})[\s/.,-]*(\d{2}|\d{4})?$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? validDate(m[3] ? fullYear(+m[3]) : defaultYear, month, +m[1]) : null;
  }
  return null;
}

/** A bare day number after a known date: the same month, or the next one once the day number goes back down. */
function nextBareDay(day: number, prev: string): string | null {
  const [y, m, pd] = prev.split("-").map(Number);
  const [ny, nm] = day < pd ? (m === 12 ? [y + 1, 1] : [y, m + 1]) : [y, m];
  return validDate(ny, nm, day);
}

const MARK: Record<string, ImportMark> = { P: "PRESENT", PRESENT: "PRESENT", A: "ABSENT", ABSENT: "ABSENT" };
const BLANKS = new Set(["", "-", "--"]);
const ROLL_HEADER = /^(regd|reg\.?\s?no|roll)/i;
const NOT_A_DATE = /^(s\.?\s?no|sl|name|student|cc|ac|total|%|percent|remarks?)/i;
// A Regd. No has letters and digits and no spaces/dots ("26BV1A05001"); the register footer ("REGISTRAR", "15.10.2026") does not.
const looksLikeRoll = (v: string) => /^[A-Z0-9-]{6,}$/.test(v) && /\d/.test(v) && /[A-Z]/.test(v);

export function parsePastAttendanceGrid(rows: string[][], defaultYear: number): PastAttendanceGrid {
  const out: PastAttendanceGrid = { dates: [], students: [], errors: [], warnings: [] };
  const headerIdx = rows.findIndex((r) => r.some((c) => ROLL_HEADER.test(c.trim())));
  if (headerIdx < 0) { out.errors.push('No header row found - the first column must be "Regd. No".'); return out; }

  const header = rows[headerIdx].map((c) => c.trim());
  const rollCol = header.findIndex((c) => ROLL_HEADER.test(c));
  const ccCol = header.findIndex((c) => /^cc$/i.test(c));
  const acCol = header.findIndex((c) => /^ac$/i.test(c));
  const dateCols: { col: number; date: string }[] = [];
  let prev: string | null = null;
  header.forEach((h, col) => {
    if (col === rollCol || !h || NOT_A_DATE.test(h)) return;
    let date = parseDateHeader(h, defaultYear);
    if (!date && /^\d{1,2}$/.test(h)) {
      if (!prev) { out.errors.push(`Column "${h}" is a bare day number with no full date before it to take the month from.`); return; }
      date = nextBareDay(+h, prev);
    }
    if (!date) { out.errors.push(`Column "${h}" is not a date or a recognised heading.`); return; }
    if (dateCols.some((d) => d.date === date)) { out.errors.push(`The date ${date} appears in two columns.`); return; }
    dateCols.push({ col, date });
    prev = date;
  });
  if (dateCols.length === 0 && out.errors.length === 0) out.errors.push("No date columns found.");
  out.dates = dateCols.map((d) => d.date);

  if (ccCol >= 0) {
    const cc = rows.slice(headerIdx + 1).map((r) => Number(r[ccCol])).find((n) => Number.isFinite(n) && n > 0);
    if (cc != null && cc !== dateCols.length) out.warnings.push(`The register says ${cc} classes conducted (CC) but the sheet has ${dateCols.length} date columns.`);
  }

  const seen = new Set<string>();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const roll = (rows[r][rollCol] ?? "").trim().toUpperCase();
    const cells = dateCols.map(({ col }) => (rows[r][col] ?? "").trim().toUpperCase());
    if (!looksLikeRoll(roll)) {
      // Footer or blank line: ignored. A line that has marks but no usable Regd. No is a real problem.
      if (roll && cells.some((c) => !BLANKS.has(c))) out.errors.push(`"${rows[r][rollCol]}" is not a Regd. No but the row has marks.`);
      continue;
    }
    if (seen.has(roll)) { out.errors.push(`Regd. No ${roll} appears twice.`); continue; }
    seen.add(roll);
    const marks = cells.map((cell, i) => {
      if (BLANKS.has(cell)) return null;
      const mark = MARK[cell];
      if (!mark) out.errors.push(`${roll}, ${dateCols[i].date}: "${rows[r][dateCols[i].col]}" is not P or A.`);
      return mark ?? null;
    });
    if (acCol >= 0) {
      const ac = Number(rows[r][acCol]);
      const present = marks.filter((m) => m === "PRESENT").length;
      if (Number.isFinite(ac) && (rows[r][acCol] ?? "").trim() !== "" && ac !== present) {
        out.warnings.push(`${roll}: the register total (AC) is ${ac} but the sheet has ${present} P marks.`);
      }
    }
    out.students.push({ roll, marks });
  }
  if (out.students.length === 0 && out.errors.length === 0) out.errors.push("No students found.");
  return out;
}
