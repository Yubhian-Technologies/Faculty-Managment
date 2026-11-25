// Student fee collection (tuition + college fees), managed by the location Accounts login (lib/fees/*).
//
//   colleges/{c}/feeBankAccounts/{id}                   the college's bank accounts fees are credited to
//   colleges/{c}/feeHeads/{id}                          the fee parts (Tuition, Special ...), each credited to one bank account
//   colleges/{c}/feeSettings/config                     admission type -> fee category (A / B / SPOT)
//   colleges/{c}/feeStructures/{id}                     a year's fee for academic year + course + batch + category (A / B),
//                                                        per head (FR-covered or not), split into instalments with due dates
//   colleges/{c}/studentFees/{academicYear}__{studentId} the student's fee account for the year (raised from a structure)
//   colleges/{c}/feeReceipts/{id}                        every payment in (counter or online); never deleted - cancelled
//   colleges/{c}/feeConcessionRequests/{id}              College Office -> Management concession requests
//
// Categories: A (Convenor / counselling) - FR (fee reimbursement: the government pays the FR-covered heads) or NFR
// (the student pays all); SPOT - the Category A fee, always paid by the student; B (Management) - paid by the
// student. Per head, the student's amount = head - government part (FR) - concessions; every head's amount is split
// over the instalments by percent, and what the student paid fills the instalments oldest first, head by head - so
// each rupee is known by head and so by bank account. Whole rupees throughout.

export type FeeCategory = "A" | "B" | "SPOT";
export type FeeFunding = "FR" | "NFR";

export interface FeeBankAccount {
  id: string;
  name: string;
  bank: string;
  accountNo: string;
  ifsc: string;
  active: boolean;
  updatedAt: string;
  updatedByName: string;
}

export interface FeeHead {
  id: string;
  name: string;
  code: string;
  order: number;
  active: boolean;
  /** The bank account this head's money is credited to. */
  bankAccountId?: string | null;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
}

export interface FeeSettings {
  /** Admission type as on student records (upper case) -> fee category. */
  categoryOf: Record<string, FeeCategory>;
  updatedAt?: string;
  updatedByName?: string;
}

export interface FeeStructureInstalment {
  no: number;
  label: string;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Share of each head's amount, in percent (all instalments add up to 100). */
  percent: number;
}

export interface FeeLateFine {
  /** PER_DAY: `amount` per day overdue after `graceDays`; FLAT: `amount` once overdue after `graceDays`. */
  kind: "PER_DAY" | "FLAT";
  amount: number;
  graceDays: number;
  /** Most it can come to per instalment (PER_DAY). */
  cap?: number;
}

export type FeeStructureStatus = "DRAFT" | "PUBLISHED";

export interface FeeStructureHead { headId: string; name: string; amount: number; /** Category A: paid by the government for FR students. */ frCovered: boolean }

export interface FeeStructure {
  id: string;
  /** "2026-27" */
  academicYear: string;
  courseKey: string;
  courseName: string;
  /** The students' admission batch, e.g. "2026-2030". */
  batch: string;
  /** A (also used for SPOT students) or B. */
  category: "A" | "B";
  heads: FeeStructureHead[];
  total: number;
  instalments: FeeStructureInstalment[];
  lateFine?: FeeLateFine | null;
  status: FeeStructureStatus;
  rev: number;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
  publishedAt?: string;
  history?: { at: string; byName: string; action: string; reason?: string }[];
}

export interface FeeConcession {
  id: string;
  amount: number;
  /** The fee head it is given on, or none for the whole fee. */
  headId?: string | null;
  headName?: string | null;
  reason: string;
  referralName?: string;
  /** The approved request it came from. */
  requestId?: string;
  at: string;
  /** Who approved it (Management). */
  byName: string;
}

/** One head on a student's account. */
export interface StudentFeeHead {
  headId: string;
  name: string;
  /** The year's fee for the head. */
  amount: number;
  frCovered: boolean;
  bankAccountId: string | null;
  bankAccountName: string;
  /** Paid by the government (FR students, FR-covered heads). */
  govt: number;
  /** Concessions applied on this head. */
  concession: number;
  /** What the student pays on this head: amount - govt - concession. */
  student: number;
}

export interface StudentFeeInstalment {
  no: number;
  label: string;
  dueDate: string;
  /** The student's amount for this instalment (the heads added up). */
  amount: number;
  /** Per head id. */
  byHead: Record<string, number>;
}

export interface StudentFeeAccount {
  id: string;
  academicYear: string;
  studentId: string;
  studentUid?: string | null;
  rollNumber: string;
  name: string;
  department: string;
  section: string;
  year?: number | null;
  courseId: string;
  courseKey: string;
  courseName: string;
  batch: string;
  admissionType: string;
  category: FeeCategory;
  /** Category A only can be FR; SPOT and B are always NFR. */
  funding: FeeFunding;
  fundingNote?: string;
  structureId: string;
  /** The structure's instalment plan (percent + due dates), kept to re-split when shares change. */
  plan: FeeStructureInstalment[];
  heads: StudentFeeHead[];
  /** The year's fee (all heads). */
  gross: number;
  concessions: FeeConcession[];
  concessionTotal: number;
  /** Concession that could not be used (more than the student pays) - for Accounts to look at. */
  concessionUnused: number;
  /** What the government pays (FR). */
  govtShare: number;
  /** What the government money received so far comes to (Scholarship Cell). */
  govtReceived: number;
  /** What the student pays (all heads). */
  studentShare: number;
  instalments: StudentFeeInstalment[];
  lateFine?: FeeLateFine | null;
  /** Paid by the student (receipts not cancelled). */
  paid: number;
  /** studentShare - paid (negative = paid more than owed - to refund or carry forward). */
  balance: number;
  status: "OPEN" | "CLEARED";
  rev: number;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
  history?: { at: string; byName: string; action: string; detail?: string }[];
}

export type FeePaymentMode = "CASH" | "DD" | "UPI" | "BANK" | "CHEQUE" | "ONLINE";

export interface FeeAllocation { no: number; label: string; headId: string; headName: string; bankAccountId: string | null; bankAccountName: string; amount: number }

export interface FeeReceipt {
  id: string;
  receiptNo: string;
  academicYear: string;
  accountId: string;
  studentId: string;
  rollNumber: string;
  name: string;
  department: string;
  section: string;
  courseName: string;
  amount: number;
  source: "COUNTER" | "ONLINE";
  mode: FeePaymentMode;
  /** UTR / DD no / cheque no / CCAvenue tracking id. */
  reference: string;
  bank?: string;
  /** YYYY-MM-DD the money was paid. */
  paidOn: string;
  /** Instalment x head (with its bank account) it went to. */
  allocation: FeeAllocation[];
  paymentId?: string;
  remarks?: string;
  cancelled?: { at: string; byName: string; reason: string } | null;
  createdAt: string;
  byName: string;
}

export type ConcessionRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface FeeConcessionRequest {
  id: string;
  collegeId: string;
  collegeName: string;
  accountId: string;
  academicYear: string;
  studentId: string;
  rollNumber: string;
  name: string;
  department: string;
  section: string;
  courseName: string;
  category: FeeCategory;
  funding: FeeFunding;
  /** The student's fee and share when asked (for Management's view). */
  gross: number;
  studentShare: number;
  amount: number;
  headId?: string | null;
  headName?: string | null;
  reason: string;
  referralName: string;
  referralDetails?: string;
  letterUrl: string;
  letterPath: string;
  letterName: string;
  status: ConcessionRequestStatus;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName?: string;
  decidedAt?: string;
  approvedAmount?: number;
  remarks?: string;
}
