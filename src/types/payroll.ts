import type { Timestamp } from "firebase/firestore";
import type { Designation, EmploymentType } from "./core";

// ─── Salary Structure (old template per designation; kept for the old route only) ───────────────

export interface SalaryStructure {
  id: string;
  collegeId: string;
  name: string;                 // e.g. "Assistant Professor – Permanent 2024"
  designation: Designation;
  employmentType: EmploymentType;
  basic: number;
  hraPercent: number;           // % of basic
  daPercent: number;            // % of basic
  ta: number;                   // fixed transport allowance
  medicalAllowance: number;
  otherAllowances: number;
  employeePfPercent: number;    // employee PF contribution % of basic
  employerPfPercent: number;    // employer PF contribution % of basic (cost, not deducted)
  professionalTax: number;      // fixed per state slab
  grossSalary: number;          // pre-computed = basic + hra + da + ta + medical + other
  effectiveFrom: Timestamp;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Payroll: components and rules (Accounts, per college) ──────────────────────
// colleges/{c}/payrollSettings/config

/** A pay part that adds to gross (E.B, AGP, DA, HRA, OA, SA ...). */
export interface PayEarning {
  id: string;                   // stable key, e.g. "EB" - never changes once used
  label: string;                // printed name, e.g. "E.B"
  prorate: boolean;             // reduced by loss of pay
  pfWage: boolean;              // counts towards the PF wage
  esiWage: boolean;             // counts towards the ESI wage
  taxable: boolean;             // counts as taxable salary (HRA is handled by its exemption)
  active: boolean;              // retired parts stay for old months, never deleted
}

export interface PtSlab { upTo: number | null; amount: number }   // null = and above

export type PayDeduction =
  | { kind: "PF"; id: string; label: string; active: boolean; percent: number; cap: number }
  | { kind: "SLAB"; id: string; label: string; active: boolean; slabs: PtSlab[] }
  | { kind: "ESI"; id: string; label: string; active: boolean; percent: number; wageLimit: number; roundUp: boolean }
  | { kind: "FLAT"; id: string; label: string; active: boolean; amount: number }
  | { kind: "INCOME_TAX"; id: string; label: string; active: boolean }
  | { kind: "ADVANCE"; id: string; label: string; active: boolean }
  | { kind: "MANUAL"; id: string; label: string; active: boolean };

export type PayDeductionKind = PayDeduction["kind"];

export type PayDayBasis = "CALENDAR" | "FIXED_30";

export interface PayrollSettings {
  earnings: PayEarning[];
  deductions: PayDeduction[];
  payDayBasis: PayDayBasis;
  tdsRoundTo: number;           // monthly TDS rounded to this many rupees (100 per the sheet)
  signatureLabels: string[];    // printed under the register
  version: number;
  updatedAt?: string;
  updatedByName?: string;
}

// ─── Employee pay (Accounts) ────────────────────────────────────────────────────
// colleges/{c}/employeePay/{kind}_{recordId}

export type PayEmployeeKind = "FACULTY" | "STAFF";

/** One version of a person's pay, in force from the 1st of `effectiveFrom` ("YYYY-MM"). */
export interface PayRevision {
  effectiveFrom: string;
  amounts: Record<string, number>;  // earning id -> fixed monthly amount
  exempt: string[];                 // deduction ids that don't apply (e.g. no PF)
  note?: string;
  byName: string;
  byUid: string;
  at: string;                       // ISO time
}

export interface EmployeePay {
  employeeKey: string;              // `${kind}_${recordId}`
  kind: PayEmployeeKind;
  recordId: string;                 // facultyMembers / supportingStaff doc id
  employeeCode: string;             // Emp Code at the time of the last save (matched on import)
  name: string;                     // display copy; the record stays the source
  revisions: PayRevision[];         // oldest first
  updatedAt?: string;
  updatedByName?: string;
}

// ─── Monthly payroll run ─────────────────────────────────────────────────────────
// colleges/{c}/payrollRuns/{YYYY-MM} + lines/{employeeKey}
// DRAFT -(Office submits)-> SUBMITTED -(Accounts)-> RETURNED (back to the Office) | APPROVED -> RELEASED (locked).

export type PayrollRunStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "RELEASING" | "RELEASED";

export interface PayrollRunEvent { action: string; byName: string; byUid: string; at: string; remarks?: string }

export interface PayrollSectionTotals { count: number; gross: number; totalDeductions: number; net: number }

export interface PayrollTotals {
  count: number;                       // lines in the register
  grossActual: number;
  earned: Record<string, number>;      // per earning id
  oneOffs: number;
  gross: number;
  deductions: Record<string, number>;  // per deduction id
  totalDeductions: number;
  net: number;
  held: number;                        // lines on hold
  heldNet: number;
  notCredited: number;
  shortfalls: number;                  // lines whose deductions exceed G.SAL - blocks submit / approve
  sections: Record<"TEACHING" | "NON_TEACHING", PayrollSectionTotals>;
}

export interface PayrollRun {
  month: string;
  status: PayrollRunStatus;
  monthDays: number;
  /** Settings the lines were worked out with (labels and order for the register). */
  settings: Pick<PayrollSettings, "earnings" | "deductions" | "payDayBasis" | "signatureLabels" | "version"> & { tdsRoundTo?: number };
  totals: PayrollTotals;
  excluded: { employeeKey: string; employeeCode: string; name: string; reason: string }[];
  rev: number;
  calculatedAt: string;
  /** Whether Accounts had confirmed the financial year's tax rules when the month was worked out. */
  taxRulesConfirmed?: boolean;
  history: PayrollRunEvent[];
  returnRemarks?: string;
  release?: { paidOn: string; reference: string; at: string; byName: string };
}

export interface PayrollLineMark { reason: string; byName: string; at: string }

export interface PayrollLine {
  employeeKey: string;
  kind: PayEmployeeKind;
  recordId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  section: "TEACHING" | "NON_TEACHING";
  userUid?: string;
  joiningDate?: string;
  lastWorkingDate?: string;
  bank: { account: string; ifsc: string; bankName: string };
  pan?: string;
  uan?: string;
  revisionFrom: string;
  amounts: Record<string, number>;
  exempt: string[];
  auto: {
    monthDays: number; notEmployedDays: number; leaveLop: number; attendanceLop: number; absentDates: string[]; lop: number; payDays: number;
  };
  lopOverride?: PayrollLineMark & { days: number };
  notCredited?: PayrollLineMark;
  hold?: PayrollLineMark;
  payDays: number;
  oneOffs: { label: string; amount: number; componentId?: string }[];
  manual: Record<string, number>;
  /** IT this month (the override when Accounts set one, else `tdsAuto`). */
  tds: number;
  tdsAuto?: number;
  tdsOverride?: PayrollLineMark & { amount: number };
  taxCalc?: LineTaxCalc;
  /** Advance recovery due this month (the override when Accounts set one, else `advanceAuto`). */
  advance: number;
  advanceAuto?: number;                                    // from the person's running advances
  advanceParts?: { advanceId: string; amount: number }[];  // how advanceAuto splits (oldest first)
  advanceBalance?: number;                                 // total still to recover before this month
  advanceOverride?: PayrollLineMark & { amount: number };
  result: {
    earned: Record<string, number>; oneOffTotal: number; gross: number; grossActual: number; pfWage: number; esiWage: number;
    deductions: Record<string, number>; totalDeductions: number; net: number; advanceDeferred: number; shortfall: number;
  };
  issues: string[];
  history: { at: string; byName: string; change: string }[];
}

// ─── Salary advances (Accounts) ─────────────────────────────────────────────────
// colleges/{c}/salaryAdvances/{id}. Recovered from salary by a monthly instalment (a % of the advance,
// or a typed amount - the % is shown). A recovery is recorded only when a month is RELEASED.

export type SalaryAdvanceStatus = "ACTIVE" | "PAUSED" | "CLOSED";

export interface SalaryAdvance {
  id: string;
  employeeKey: string;
  employeeCode: string;
  name: string;
  amount: number;                      // advance given
  recoveredBefore: number;             // recovered outside the app (advances running at go-live)
  instalment: number;                  // monthly recovery in rupees (the last month takes only the balance)
  recoveryPercent: number;             // instalment as a % of the amount (shown; typed or derived)
  startMonth: string;                  // first month to recover (YYYY-MM)
  givenOn?: string;                    // YYYY-MM-DD
  note?: string;
  status: SalaryAdvanceStatus;
  recoveries: Record<string, number>;  // month -> amount recovered in that released month
  closedNote?: string;
  rev: number;
  createdAt: string;
  createdByName: string;
  history: { at: string; byName: string; change: string }[];
}

// ─── Income tax (TDS) ───────────────────────────────────────────────────────────
// colleges/{c}/payrollTaxRules/{FY} - Accounts confirm the slabs each financial year (until then no TDS
// is worked out); colleges/{c}/payrollTaxProfiles/{FY}__{employeeKey} - regime + declarations + opening
// figures for the months paid before payroll moved into the app.

export interface TaxSlab { upTo: number | null; rate: number }          // rate in %, upTo null = and above
export interface SurchargeSlab { above: number; rate: number }

export interface RegimeRules {
  slabs: TaxSlab[];
  standardDeduction: number;
  rebateIncomeLimit: number;    // 87A: taxable income up to this
  rebateMax: number;            // 87A: up to this much tax
  rebateMarginalRelief: boolean;// new regime: just above the limit, tax can't exceed the income above it
  surcharge: SurchargeSlab[];   // with marginal relief at each step
}

export interface PayrollTaxRules {
  fy: string;                   // "2026-27"
  newRegime: RegimeRules;
  oldRegime: RegimeRules;
  cessPercent: number;
  caps: { c80C: number; c80CCD1B: number; c80D: number; c24b: number };
  basicParts: string[];         // earning ids that make "basic" for the HRA exemption (E.B + DA)
  hraPart: string | null;       // earning id of HRA
  version: number;
  updatedAt?: string;
  updatedByName?: string;
}

export type TaxRegime = "NEW" | "OLD";

export interface PayrollTaxProfile {
  employeeKey: string;
  fy: string;
  regime: TaxRegime;
  declarations: { c80C: number; c80CCD1B: number; c80D: number; c24b: number; other: number; rentPaid: number; metro: boolean };
  otherIncome: number;
  previousEmployer: { salary: number; tds: number; pt: number };
  /** Figures for the months paid before payroll moved into the app (Apr .. upToMonth). */
  opening?: { upToMonth: string; gross: number; hra: number; basic: number; tds: number; pf: number; pt: number };
  rev: number;
  updatedAt?: string;
  updatedByName?: string;
  history?: { at: string; byName: string; change: string }[];
}

/** How a line's TDS was worked out (kept on the line). */
export interface LineTaxCalc {
  fy: string;
  regime: TaxRegime;
  rulesConfirmed: boolean;
  annualSalary: number;
  taxableIncome: number;
  annualTax: number;
  deductedBefore: number;       // TDS already deducted this FY (opening + released months + previous employer)
  monthsLeft: number;           // this month to March
}
