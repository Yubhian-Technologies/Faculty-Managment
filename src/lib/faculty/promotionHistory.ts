import { designationKey } from "@/lib/designations/config";

// Promotion History = the faculty member's designation history in THIS college: a
// chronological, gap-free, overlap-free chain of designations, each held once.
//
//   Assistant Professor  01-06-2020 -> 31-05-2023
//   Associate Professor  01-06-2023 -> 31-05-2025
//   Professor            01-06-2025 -> (open)   <- the running designation
//
// Pure functions only (no Firestore, no React) so the College Office page (live
// errors) and PATCH /api/college/faculty/[id]/promotion-salary (enforcement) apply
// exactly the same rules. Dates are "YYYY-MM-DD" strings throughout.

export interface PromotionRow {
  designation?: string;
  fromDate?: string;
  toDate?: string;
  promotionOrderUrl?: string;
}

export interface PromotionIssue {
  /** Index in the array that was validated; undefined for a problem with the list as a whole. */
  row?: number;
  field?: "designation" | "fromDate" | "toDate";
  message: string;
}

export interface PromotionContext {
  /** Faculty Date of Joining ("YYYY-MM-DD"); the first period must start on it. Skipped when unknown. */
  joiningDate?: string;
  /** FacultyMember.status - Resigned/Retired faculty have no running designation. */
  status?: string;
  /** "YYYY-MM-DD"; injectable for tests. Defaults to today. */
  today?: string;
}

/** academicProfile key owned by College Office (PATCH .../promotion-salary); generic edit routes never write it. */
export const PROMOTION_HISTORY_KEY = "promotionHistory";

/** Message returned when a generic edit tries to change a designation that Promotion History controls. */
export const DESIGNATION_MANAGED_BY_HISTORY_MESSAGE =
  "This faculty member's designation is managed by their Promotion History - College Office updates it under Promotion & Salary.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENDED_STATUSES = ["RESIGNED", "RETIRED"];

export function isEndedStatus(status: string | undefined): boolean {
  return !!status && ENDED_STATUSES.includes(status);
}

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "YYYY-MM-DD" + n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A stored Date/Timestamp as a calendar day. Joining dates are saved at local
 * midnight by some paths (CSV import) and UTC midnight by others (Add form), so
 * the instant is rounded to the nearest day rather than truncated.
 */
export function toDateOnly(value: unknown): string | undefined {
  let ms: number | undefined;
  if (value instanceof Date) ms = value.getTime();
  else if (value && typeof value === "object") {
    const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof v.toDate === "function") ms = v.toDate().getTime();
    else if (typeof v._seconds === "number") ms = v._seconds * 1000;
    else if (typeof v.seconds === "number") ms = v.seconds * 1000;
  } else if (typeof value === "string" && value) {
    return isRealDate(value.slice(0, 10)) ? value.slice(0, 10) : undefined;
  }
  if (ms === undefined || Number.isNaN(ms)) return undefined;
  return new Date(ms + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

const blank = (v: string | undefined) => !v || !v.trim();

/** Chronological order (rows with no usable From Date go last, keeping their relative order). */
export function sortPromotionHistory<T extends PromotionRow>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const af = a.r.fromDate && isRealDate(a.r.fromDate) ? a.r.fromDate : "9999-99-99";
      const bf = b.r.fromDate && isRealDate(b.r.fromDate) ? b.r.fromDate : "9999-99-99";
      return af < bf ? -1 : af > bf ? 1 : a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * Every rule violation in `rows` (empty array = valid). An empty history is valid -
 * "nothing recorded" - the chain rules apply once at least one row exists.
 * `row` in each issue indexes into `rows` as given (not the sorted order).
 */
export function validatePromotionHistory(rows: PromotionRow[], ctx: PromotionContext = {}): PromotionIssue[] {
  const issues: PromotionIssue[] = [];
  if (rows.length === 0) return issues;
  const today = ctx.today ?? todayIso();
  const ended = isEndedStatus(ctx.status);

  // ── Per-row checks ──
  const usable: { row: PromotionRow; idx: number }[] = [];
  rows.forEach((row, idx) => {
    let rowOk = true;
    if (blank(row.designation)) { issues.push({ row: idx, field: "designation", message: "Select a designation." }); rowOk = false; }
    if (blank(row.fromDate)) { issues.push({ row: idx, field: "fromDate", message: "From Date is required." }); rowOk = false; }
    else if (!isRealDate(row.fromDate!)) { issues.push({ row: idx, field: "fromDate", message: "From Date is not a valid date." }); rowOk = false; }
    else if (row.fromDate! > today) { issues.push({ row: idx, field: "fromDate", message: "From Date cannot be in the future." }); rowOk = false; }
    if (!blank(row.toDate)) {
      if (!isRealDate(row.toDate!)) { issues.push({ row: idx, field: "toDate", message: "To Date is not a valid date." }); rowOk = false; }
      else if (row.toDate! > today) { issues.push({ row: idx, field: "toDate", message: "To Date cannot be in the future." }); rowOk = false; }
      else if (!blank(row.fromDate) && isRealDate(row.fromDate!) && row.toDate! < row.fromDate!) {
        issues.push({ row: idx, field: "toDate", message: "To Date cannot be before From Date." }); rowOk = false;
      }
    }
    if (rowOk) usable.push({ row, idx });
  });

  // ── No designation twice (compared by display label, so the code
  //    ASSISTANT_PROFESSOR and "Assistant Professor" are the same designation) ──
  const seen = new Map<string, number>();
  rows.forEach((row, idx) => {
    if (blank(row.designation)) return;
    const key = designationKey(row.designation);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, idx);
    else issues.push({ row: idx, field: "designation", message: "This designation is already in the history - each designation can appear only once." });
  });

  // Chain rules only make sense when every row has usable dates.
  if (usable.length !== rows.length) return issues;

  const sorted = [...usable].sort((a, b) => (a.row.fromDate! < b.row.fromDate! ? -1 : a.row.fromDate! > b.row.fromDate! ? 1 : a.idx - b.idx));

  // ── First period starts on the Date of Joining ──
  if (ctx.joiningDate && isRealDate(ctx.joiningDate) && sorted[0].row.fromDate !== ctx.joiningDate) {
    issues.push({
      row: sorted[0].idx, field: "fromDate",
      message: `The first designation must start on the Date of Joining (${ctx.joiningDate}).`,
    });
  }

  // ── Continuity: no overlap, no gap, only the last period may be open ──
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (blank(prev.row.toDate)) {
      issues.push({ row: prev.idx, field: "toDate", message: "Only the last designation can be ongoing - set a To Date for this one." });
      continue;
    }
    const expected = addDays(prev.row.toDate!, 1);
    if (cur.row.fromDate! <= prev.row.toDate!) {
      issues.push({ row: cur.idx, field: "fromDate", message: `Overlaps the previous designation - it must start on ${expected}.` });
    } else if (cur.row.fromDate! !== expected) {
      issues.push({ row: cur.idx, field: "fromDate", message: `There is a gap after the previous designation - it must start on ${expected}.` });
    }
  }

  // ── The running designation ──
  const last = sorted[sorted.length - 1];
  if (ended) {
    if (blank(last.row.toDate)) {
      issues.push({ row: last.idx, field: "toDate", message: "This faculty member has left - set the To Date (last day in this designation)." });
    }
  } else if (!blank(last.row.toDate)) {
    issues.push({ row: last.idx, field: "toDate", message: "The current designation must not have a To Date - leave it blank while they are still serving." });
  }

  return issues;
}

/**
 * The designation the Faculty record should carry: the running (open) period's, or - for
 * someone who has left - the last one held. Undefined for an empty history. Returned
 * verbatim (catalogue value), never relabelled.
 */
export function runningDesignation(rows: PromotionRow[]): string | undefined {
  const sorted = sortPromotionHistory(rows.filter((r) => !blank(r.designation) && !blank(r.fromDate)));
  if (sorted.length === 0) return undefined;
  const open = sorted.filter((r) => blank(r.toDate));
  return (open.length > 0 ? open[open.length - 1] : sorted[sorted.length - 1]).designation;
}

/** The From Date a newly added row should start with: the day after the last period ends, or the joining date. */
export function suggestedNextFromDate(rows: PromotionRow[], joiningDate?: string): string | undefined {
  const sorted = sortPromotionHistory(rows.filter((r) => !blank(r.fromDate)));
  const last = sorted[sorted.length - 1];
  if (!last) return joiningDate;
  return last.toDate && isRealDate(last.toDate) ? addDays(last.toDate, 1) : undefined;
}

/** Whether two histories are the same list of periods (order-insensitive, ignoring blank vs missing). */
export function samePromotionHistory(a: PromotionRow[], b: PromotionRow[]): boolean {
  const norm = (rows: PromotionRow[]) =>
    JSON.stringify(
      sortPromotionHistory(rows).map((r) => [
        (r.designation ?? "").trim(), (r.fromDate ?? "").trim(), (r.toDate ?? "").trim(), (r.promotionOrderUrl ?? "").trim(),
      ])
    );
  return norm(a) === norm(b);
}

/** Rows as they should be stored: sorted, trimmed, and without empty/undefined keys (Firestore rejects undefined). */
export function normalizePromotionHistory(rows: PromotionRow[]): PromotionRow[] {
  return sortPromotionHistory(rows).map((r) => ({
    designation: (r.designation ?? "").trim(),
    ...(!blank(r.fromDate) ? { fromDate: r.fromDate!.trim() } : {}),
    ...(!blank(r.toDate) ? { toDate: r.toDate!.trim() } : {}),
    ...(!blank(r.promotionOrderUrl) ? { promotionOrderUrl: r.promotionOrderUrl!.trim() } : {}),
  }));
}
