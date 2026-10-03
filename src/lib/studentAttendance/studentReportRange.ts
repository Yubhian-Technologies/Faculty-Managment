// Pure range resolution for the student's own "My Attendance" report - the
// Month / Period / Semester / Till now views. Kept free of Firestore so the
// boundaries (real month ends, inclusive dates, which semesters a student has
// reached) are unit-tested.

export type ReportView = "month" | "period" | "semester" | "tillnow";

export const REPORT_VIEWS: ReportView[] = ["month", "period", "semester", "tillnow"];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface SemesterRange {
  semester: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** Course year this semester is configured on (set by semesterOptionsForStudent). */
  year?: number;
  /** 1-based position among that year's own semesters: "Semester-I" / "Semester-II" of the year. */
  inYear?: number;
}

export interface ReportParams {
  year?: string | null;
  month?: string | null;
  from?: string | null;
  to?: string | null;
  semester?: string | null;
}

export type ResolvedRange =
  | { ok: true; from: string | null; to: string | null; label: string }
  | { ok: false; error: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last calendar day of a month (month is 1-12), leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-10-03" -> "03-10-2026" - the label format the faculty report already uses. */
export function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isReportView(v: string | null | undefined): v is ReportView {
  return !!v && (REPORT_VIEWS as string[]).includes(v);
}

export function resolveReportRange(view: ReportView, params: ReportParams, semesters: SemesterRange[]): ResolvedRange {
  if (view === "tillnow") return { ok: true, from: null, to: null, label: "Till now" };

  if (view === "month") {
    const year = Number(params.year);
    const month = Number(params.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error: "Pick a valid year" };
    if (!Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: "Pick a valid month" };
    return {
      ok: true,
      from: `${year}-${pad(month)}-01`,
      to: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
    };
  }

  if (view === "period") {
    const from = params.from ?? "";
    const to = params.to ?? "";
    if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: "Pick both a From and a To date" };
    if (from > to) return { ok: false, error: "From date must not be after the To date" };
    return { ok: true, from, to, label: `${ddmmyyyy(from)} to ${ddmmyyyy(to)}` };
  }

  const wanted = Number(params.semester);
  const match = semesters.find((s) => s.semester === wanted);
  if (!Number.isInteger(wanted) || !match) return { ok: false, error: "That semester isn't available for you" };
  return { ok: true, from: match.startDate, to: match.endDate, label: `Semester ${match.semester}` };
}

export interface YearTiming {
  year: number;
  semesters: SemesterRange[];
}

/**
 * Every semester a student can have attendance in: those configured on years
 * 1..studentYear whose start date has already passed. Semester numbers are
 * global (Year 1 = 1-2, Year 2 = 3-4, ...), so they are de-duplicated by
 * number. A year with no timing (e.g. a lateral entrant's missing Year 1) just
 * contributes nothing.
 */
export function semesterOptionsForStudent(timings: YearTiming[], studentYear: number, today: string): SemesterRange[] {
  const byNumber = new Map<number, SemesterRange>();
  for (const t of timings) {
    if (t.year < 1 || t.year > studentYear) continue;
    const ordered = [...t.semesters].sort((a, b) => a.semester - b.semester);
    ordered.forEach((s, i) => {
      if (s.startDate > today) return;
      if (!byNumber.has(s.semester)) byNumber.set(s.semester, { ...s, year: t.year, inYear: i + 1 });
    });
  }
  return Array.from(byNumber.values()).sort((a, b) => a.semester - b.semester);
}

/** First four-digit year in an admission batch like "2024-2028"; null when absent. */
export function batchStartYear(batch: string | null | undefined): number | null {
  const m = /(\d{4})/.exec(batch ?? "");
  return m ? Number(m[1]) : null;
}

/** Years offered in the Month picker: admission year (or three back) up to this year, newest first. */
export function monthPickerYears(batch: string | null | undefined, currentYear: number): number[] {
  const start = batchStartYear(batch);
  const first = start && start <= currentYear ? start : currentYear - 3;
  const years: number[] = [];
  for (let y = currentYear; y >= first; y--) years.push(y);
  return years;
}

/** The semester `today` falls in, else the latest one that has started (e.g. between two semesters). */
export function currentSemesterOf(options: SemesterRange[], today: string): SemesterRange | null {
  const within = options.find((s) => s.startDate <= today && today <= s.endDate);
  if (within) return within;
  return options.length > 0 ? options[options.length - 1] : null;
}

function roman(n: number): string {
  const map: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X" };
  return map[n] ?? String(n);
}

/**
 * "III/IV Semester-I": year of study over course duration (Roman), then the
 * semester within that year - the line the college's report prints under
 * Branch. Falls back to "III/IV Year" when no semester is known.
 */
export function classLabel(year: number, durationYears: number | null | undefined, sem: SemesterRange | null): string {
  const y = sem?.year ?? year;
  const head = y > 0 ? (durationYears ? `${roman(y)}/${roman(durationYears)}` : roman(y)) : "";
  if (sem?.inYear) return `${head} Semester-${roman(sem.inYear)}`.trim();
  return head ? `${head} Year` : "";
}
