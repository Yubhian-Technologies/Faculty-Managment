import type {
  FeeAllocation, FeeCategory, FeeConcession, FeeFunding, FeeLateFine, FeeStructure, FeeStructureInstalment, StudentFeeAccount, StudentFeeHead, StudentFeeInstalment,
} from "@/types/fees";

// Student fee rules (pure, browser + server). Whole rupees. Per head the student's amount = head - government part
// (FR students, FR-covered heads) - concessions (on the head first, then whole-fee ones spread over what is left);
// each head's amount is split over the instalments by percent (rounded down, the last one takes the remainder), and
// what the student paid fills the instalments oldest first, head by head in the account's order.

export const ACADEMIC_YEAR_RE = /^\d{4}-\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (n: unknown) => (typeof n === "number" ? n : Number(n));
const isWhole = (n: number) => Number.isInteger(n) && n >= 0;

/** The academic year a date falls in (June starts a new one): 2026-11-25 -> "2026-27". */
export function academicYearOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const normType = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Default admission type -> category, used for types the college has not mapped. */
export function defaultCategory(type: string): FeeCategory | null {
  const t = normType(type);
  if (!t) return null;
  if (/SPOT/.test(t)) return "SPOT";
  if (/MANAGEMENT|NRI|CAT(EGORY)?[- ]?B\b/.test(t)) return "B";
  if (/CONVENOR|CONVENER|COUNSEL|EAMCET|ECET|CAT(EGORY)?[- ]?A\b/.test(t)) return "A";
  return null;
}
export const categoryOfType = (type: string, map: Record<string, FeeCategory>): FeeCategory | null => map[normType(type)] ?? defaultCategory(type);
const BATCH_RE = /^(\d{4})-(\d{4})$/;

/** The year of study a batch is in during the academic year starting `currentStart` ("2024-2028" in 2026 = 3); null when the text isn't a batch. */
export function yearOfBatch(batch: string, currentStart: number): number | null {
  const m = BATCH_RE.exec(batch.trim());
  return m ? currentStart - Number(m[1]) + 1 : null;
}

/**
 * The student's batch for fees: the stored one, else worked out from the year of study (many colleges never stored a
 * batch on the student - VIT). Empty when neither is known.
 */
export function studentFeeBatch(s: { batch?: string; year?: number }, currentStart: number, durationYears: number | undefined): string {
  const own = String(s.batch ?? "").trim();
  if (own) return own;
  const y = Number(s.year);
  if (!Number.isInteger(y) || y < 1 || !durationYears) return "";
  const start = currentStart - y + 1;
  return `${start}-${start + durationYears}`;
}

/** In the batch being raised: the same, or a lateral entrant's (later start, same end year). */
export function inFeeBatch(studentBatch: string, batch: string): boolean {
  if (!studentBatch) return false;
  if (studentBatch === batch) return true;
  const a = BATCH_RE.exec(studentBatch), b = BATCH_RE.exec(batch.trim());
  return !!a && !!b && a[2] === b[2] && Number(a[1]) > Number(b[1]);
}

/** The structure a category takes its fee from (SPOT = Category A's). */
export const structureCategory = (c: FeeCategory): "A" | "B" => (c === "B" ? "B" : "A");
/** SPOT and B are always paid by the student. */
export const canBeFr = (c: FeeCategory) => c === "A";
export const CATEGORY_LABEL: Record<FeeCategory, string> = { A: "Category A", B: "Category B", SPOT: "Spot" };

export interface StructureInput {
  academicYear: unknown; courseKey: unknown; courseName: unknown; batch: unknown; category: unknown;
  heads: unknown; instalments: unknown; lateFine?: unknown;
}

/** Checks a structure from the form; returns its fields cleaned, or the first problem. */
export function cleanStructure(raw: StructureInput, headNames: Map<string, string>):
  { value: Pick<FeeStructure, "academicYear" | "courseKey" | "courseName" | "batch" | "category" | "heads" | "total" | "instalments" | "lateFine"> } | { error: string } {
  const academicYear = String(raw.academicYear ?? "").trim();
  if (!ACADEMIC_YEAR_RE.test(academicYear)) return { error: "Select the academic year (for example 2026-27)." };
  const courseKey = String(raw.courseKey ?? "").trim(), courseName = String(raw.courseName ?? "").trim();
  if (!courseKey || !courseName) return { error: "Select a course." };
  const batch = String(raw.batch ?? "").trim();
  if (!/^\d{4}-\d{4}$/.test(batch)) return { error: "Enter the batch (for example 2026-2030)." };
  const category = raw.category === "B" ? "B" : raw.category === "A" ? "A" : null;
  if (!category) return { error: "Select the category (A or B)." };

  const headsRaw = Array.isArray(raw.heads) ? raw.heads : [];
  const heads: FeeStructure["heads"] = [];
  for (const h0 of headsRaw) {
    const h = (h0 ?? {}) as { headId?: unknown; amount?: unknown; frCovered?: unknown };
    const headId = String(h.headId ?? "");
    const amount = rupees(h.amount);
    if (!headNames.has(headId)) return { error: "A fee head is not found. Reload and try again." };
    if (heads.some((x) => x.headId === headId)) return { error: `${headNames.get(headId)} is listed twice.` };
    if (!isWhole(amount) || amount > 10_000_000) return { error: `${headNames.get(headId)}: enter the amount in whole rupees.` };
    if (amount > 0) heads.push({ headId, name: headNames.get(headId)!, amount, frCovered: category === "A" && h.frCovered === true });
  }
  if (!heads.length) return { error: "Enter the amount of at least one fee head." };
  const total = heads.reduce((n, h) => n + h.amount, 0);

  const instRaw = Array.isArray(raw.instalments) ? raw.instalments : [];
  if (instRaw.length < 1 || instRaw.length > 12) return { error: "Add 1 to 12 instalments." };
  const instalments: FeeStructureInstalment[] = [];
  for (const [i, x0] of instRaw.entries()) {
    const x = (x0 ?? {}) as { label?: unknown; dueDate?: unknown; percent?: unknown };
    const dueDate = String(x.dueDate ?? "");
    const percent = rupees(x.percent);
    if (!DATE_RE.test(dueDate)) return { error: `Instalment ${i + 1}: enter the due date.` };
    if (!(percent > 0) || percent > 100 || Math.round(percent * 100) !== percent * 100) return { error: `Instalment ${i + 1}: enter its share in percent (up to 2 decimals).` };
    if (instalments.length && dueDate <= instalments[instalments.length - 1].dueDate) return { error: `Instalment ${i + 1} must be due after instalment ${i}.` };
    instalments.push({ no: i + 1, label: String(x.label ?? "").trim().slice(0, 40) || `Instalment ${i + 1}`, dueDate, percent });
  }
  const pct = Math.round(instalments.reduce((n, x) => n + x.percent, 0) * 100) / 100;
  if (pct !== 100) return { error: `The instalments add up to ${pct}% - they must add up to 100%.` };

  let lateFine: FeeLateFine | null = null;
  if (raw.lateFine && typeof raw.lateFine === "object") {
    const f = raw.lateFine as { kind?: unknown; amount?: unknown; graceDays?: unknown; cap?: unknown };
    const amount = rupees(f.amount), graceDays = rupees(f.graceDays ?? 0), cap = f.cap == null || f.cap === "" ? undefined : rupees(f.cap);
    if (f.kind !== "PER_DAY" && f.kind !== "FLAT") return { error: "Choose how the late fine is charged." };
    if (!isWhole(amount) || amount === 0) return { error: "Enter the late fine in whole rupees." };
    if (!isWhole(graceDays) || graceDays > 365) return { error: "Grace days must be from 0 to 365." };
    if (cap !== undefined && (!isWhole(cap) || cap < amount)) return { error: "The late fine cap must be at least the fine." };
    lateFine = { kind: f.kind, amount, graceDays, ...(cap !== undefined ? { cap } : {}) };
  }
  return { value: { academicYear, courseKey, courseName, batch, category, heads, total, instalments, lateFine } };
}

/** Splits `total` over `weights` in proportion (rounded down; the largest remainders get the leftover rupees). */
export function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; if (weights[i] > 0) { out[i] += 1; left -= 1; } }
  return out;
}

type HeadBase = Pick<StudentFeeHead, "headId" | "name" | "amount" | "frCovered" | "bankAccountId" | "bankAccountName">;

/** Each head's government part, concession and student amount; plus any concession that could not be used. */
export function headShares(heads: HeadBase[], funding: FeeFunding, concessions: Pick<FeeConcession, "amount" | "headId">[]): { heads: StudentFeeHead[]; unused: number } {
  const rows = heads.map((h) => {
    const govt = funding === "FR" && h.frCovered ? h.amount : 0;
    return { ...h, govt, concession: 0, student: h.amount - govt };
  });
  let pool = 0;
  for (const c of concessions) {
    const row = c.headId ? rows.find((r) => r.headId === c.headId) : null;
    if (!row) { pool += c.amount; continue; }
    const take = Math.min(c.amount, row.student);
    row.concession += take; row.student -= take; pool += c.amount - take;
  }
  const payable = rows.reduce((n, r) => n + r.student, 0);
  const used = Math.min(pool, payable);
  spread(used, rows.map((r) => r.student)).forEach((x, i) => { rows[i].concession += x; rows[i].student -= x; });
  return { heads: rows, unused: pool - used };
}

/** Each head's student amount split over the instalments by percent (the last instalment takes each remainder). */
export function splitInstalments(heads: Pick<StudentFeeHead, "headId" | "student">[], plan: FeeStructureInstalment[]): StudentFeeInstalment[] {
  const byInst: Record<string, number>[] = plan.map(() => ({}));
  for (const h of heads) {
    let used = 0;
    plan.forEach((p, i) => {
      const v = i === plan.length - 1 ? h.student - used : Math.floor((h.student * p.percent) / 100);
      used += v;
      byInst[i][h.headId] = v;
    });
  }
  return plan.map((p, i) => ({ no: p.no, label: p.label, dueDate: p.dueDate, byHead: byInst[i], amount: Object.values(byInst[i]).reduce((a, b) => a + b, 0) }));
}

type Totals = Pick<StudentFeeAccount, "heads" | "gross" | "concessionTotal" | "concessionUnused" | "govtShare" | "studentShare" | "instalments" | "balance" | "status">;

/** Re-works the account from its heads, funding, concessions and what was paid. */
export function recompute(a: Pick<StudentFeeAccount, "heads" | "funding" | "concessions" | "paid" | "plan">): Totals {
  const { heads, unused } = headShares(a.heads, a.funding, a.concessions);
  const gross = heads.reduce((n, h) => n + h.amount, 0);
  const govtShare = heads.reduce((n, h) => n + h.govt, 0);
  const studentShare = heads.reduce((n, h) => n + h.student, 0);
  const concessionTotal = heads.reduce((n, h) => n + h.concession, 0);
  const balance = studentShare - a.paid;
  return { heads, gross, concessionTotal, concessionUnused: unused, govtShare, studentShare, instalments: splitInstalments(heads, a.plan), balance, status: balance <= 0 ? "CLEARED" : "OPEN" };
}

export interface InstalmentState extends StudentFeeInstalment { paid: number; due: number; overdue: boolean; fine: number; paidByHead: Record<string, number> }

/** Each instalment's paid / due (what was paid fills them oldest first, head by head), overdue as of `today`, late fine. */
export function instalmentStates(a: Pick<StudentFeeAccount, "instalments" | "paid" | "lateFine" | "heads">, today: string): InstalmentState[] {
  let left = Math.max(0, a.paid);
  return a.instalments.map((x) => {
    const paidByHead: Record<string, number> = {};
    for (const h of a.heads) {
      const v = Math.min(x.byHead[h.headId] ?? 0, left);
      paidByHead[h.headId] = v;
      left -= v;
    }
    const paid = Object.values(paidByHead).reduce((n, v) => n + v, 0);
    const due = x.amount - paid;
    const overdue = due > 0 && today > x.dueDate;
    return { ...x, paid, paidByHead, due, overdue, fine: overdue ? lateFineFor(a.lateFine, x.dueDate, today) : 0 };
  });
}

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);

/** The late fine on one instalment due on `dueDate`, as of `today` (none within the grace days). */
export function lateFineFor(f: FeeLateFine | null | undefined, dueDate: string, today: string): number {
  if (!f) return 0;
  const late = daysBetween(dueDate, today) - f.graceDays;
  if (late <= 0) return 0;
  const fine = f.kind === "FLAT" ? f.amount : f.amount * late;
  return f.cap ? Math.min(fine, f.cap) : fine;
}

/** Where a new payment of `amount` lands: instalment x head (with its bank account), oldest first. */
export function allocationOf(a: Pick<StudentFeeAccount, "instalments" | "paid" | "heads">, amount: number): FeeAllocation[] {
  const before = instalmentStates({ ...a, lateFine: null }, "0000-00-00");
  const after = instalmentStates({ ...a, paid: a.paid + amount, lateFine: null }, "0000-00-00");
  const out: FeeAllocation[] = [];
  after.forEach((x, i) => {
    for (const h of a.heads) {
      const v = (x.paidByHead[h.headId] ?? 0) - (before[i].paidByHead[h.headId] ?? 0);
      if (v > 0) out.push({ no: x.no, label: x.label, headId: h.headId, headName: h.name, bankAccountId: h.bankAccountId, bankAccountName: h.bankAccountName, amount: v });
    }
  });
  return out;
}

/** The allocation added up per bank account (receipt / day book). */
export function byBankAccount(allocation: Pick<FeeAllocation, "bankAccountName" | "amount">[]): { account: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const x of allocation) m.set(x.bankAccountName || "Not set", (m.get(x.bankAccountName || "Not set") ?? 0) + x.amount);
  return [...m].map(([account, amount]) => ({ account, amount }));
}

/** Checks a counter payment: whole rupees, more than 0, not more than the balance (an excess is never taken). */
export function paymentError(amount: number, balance: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "Enter the amount in whole rupees.";
  if (balance <= 0) return "Nothing is due on this account.";
  if (amount > balance) return `That is more than the balance (Rs. ${balance}).`;
  return null;
}

/** Checks the funding a student may have: FR only for Category A. */
export function fundingError(category: FeeCategory, funding: FeeFunding): string | null {
  return funding === "FR" && !canBeFr(category) ? `${CATEGORY_LABEL[category]} students pay their own fee - they can't be FR.` : null;
}
