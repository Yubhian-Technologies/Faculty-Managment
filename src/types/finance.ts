import type { Timestamp } from "firebase/firestore";

// ─── Shared Finance Approval Primitives ────────────────────────────────────────
// Kept local to this module (not core.ts's WorkflowStatus/AuditAction) so the
// Finance data model stays fully isolated from every other dashboard's types.

export type FinanceApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "RETURNED";

export const FINANCE_APPROVAL_STATUS_LABELS: Record<FinanceApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for Correction",
};

export interface FinanceApprovalAction {
  action: FinanceApprovalStatus;
  by: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
}

// ─── Budget Management ─────────────────────────────────────────────────────────

export type FinanceBudgetStatus = "ACTIVE" | "REVISED" | "CLOSED";

export interface FinanceBudgetRevision {
  previousAmount: number;
  revisedAmount: number;
  reason: string;
  revisedBy: string;
  revisedByName: string;
  revisedAt: Timestamp;
}

export interface FinanceBudget {
  id: string;
  collegeId: string;
  department: string;
  purpose: string;
  fiscalYear: string;          // e.g. "2026-27"
  allocatedAmount: number;
  utilizedAmount: number;
  status: FinanceBudgetStatus;
  revisions: FinanceBudgetRevision[];
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sourceRequestId?: string; // links back to colleges/{id}/budgetRequests/{id}, if auto-created from one
}

// ─── Budget Approvals (requests) ───────────────────────────────────────────────

export interface FinanceBudgetRequest {
  id: string;
  collegeId: string;
  department: string;
  requestedAmount: number;
  purpose: string;
  justification?: string;
  status: FinanceApprovalStatus;
  financeRemarks?: string;
  history: FinanceApprovalAction[];
  loggedBy: string;
  loggedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Fund Allocation ────────────────────────────────────────────────────────────

export type FinanceAllocationTargetType = "DEPARTMENT" | "PROJECT" | "EVENT" | "PURCHASE";
export type FinanceAllocationStatus = "ACTIVE" | "MODIFIED" | "EXHAUSTED" | "CLOSED";

export interface FinanceFundAllocation {
  id: string;
  collegeId: string;
  budgetId: string;
  targetType: FinanceAllocationTargetType;
  targetName: string;
  amount: number;
  remainingAmount: number;
  status: FinanceAllocationStatus;
  history: Array<{
    amount: number;
    reason: string;
    changedBy: string;
    changedByName: string;
    changedAt: Timestamp;
  }>;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Expense Requests ───────────────────────────────────────────────────────────

export interface FinanceExpenseRequest {
  id: string;
  collegeId: string;
  department: string;
  budgetId: string;
  amount: number;
  purpose: string;
  justification?: string;
  status: FinanceApprovalStatus;
  financeRemarks?: string;
  history: FinanceApprovalAction[];
  loggedBy: string;
  loggedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Payments ────────────────────────────────────────────────────────────────────

export type FinancePaymentType = "VENDOR" | "STAFF_REIMBURSEMENT" | "STUDENT_REFUND";
export type FinancePaymentStatus = "PENDING" | "PROCESSED" | "VERIFIED";

export interface FinancePayment {
  id: string;
  collegeId: string;
  type: FinancePaymentType;
  payeeName: string;
  amount: number;
  purpose: string;
  relatedExpenseId?: string;
  relatedIndentId?: string;
  status: FinancePaymentStatus;
  paymentReference?: string;
  processedBy?: string;
  processedByName?: string;
  processedAt?: Timestamp;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Purchase Finance Clearance ─────────────────────────────────────────────────
// Status/history kept local to this module (not the shared FinanceApprovalStatus/
// FinanceApprovalAction, which Budget Requests and Expense Requests also use) since
// this workflow has two extra steps those don't: Finance marking goods purchased,
// then the HOD confirming receipt with a GRN.

export type PurchaseClearanceStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "GOODS_PURCHASED" // Finance marked the purchase as made; awaiting HOD's GRN
  | "COMPLETED";      // terminal; HOD uploaded the GRN confirming receipt

export const PURCHASE_CLEARANCE_STATUS_LABELS: Record<PurchaseClearanceStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for Correction",
  GOODS_PURCHASED: "Goods Purchased",
  COMPLETED: "Completed — GRN Confirmed",
};

export interface PurchaseClearanceHistoryEntry {
  action: PurchaseClearanceStatus;
  by: string;
  byName: string;
  byRole: "FINANCE" | "HOD";
  at: Timestamp;
  remarks?: string;
}

export interface FinancePurchaseClearance {
  id: string;
  collegeId: string;
  department: string;
  requestedByName: string;
  items: string;
  estimatedAmount: number;
  budgetId?: string;
  status: PurchaseClearanceStatus;
  financeComments?: string;
  history: PurchaseClearanceHistoryEntry[];
  loggedBy: string;
  loggedByName: string;
  // GRN (Goods Receipt Note) — set by the HOD once goods are confirmed received
  grnUrl?: string;
  grnFileName?: string;
  grnNumber?: string;
  grnMessage?: string;
  grnUploadedBy?: string;
  grnUploadedByName?: string;
  grnUploadedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Receipts ───────────────────────────────────────────────────────────────────

export type FinanceReceiptRelatedType = "BUDGET" | "EXPENSE" | "PAYMENT" | "ALLOCATION" | "INDENT";

export interface FinanceReceipt {
  id: string;
  collegeId: string;
  relatedType: FinanceReceiptRelatedType;
  relatedId: string;
  amount: number;
  description: string;
  fileUrl?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Audit & Compliance ──────────────────────────────────────────────────────────

export type FinanceAuditAction =
  | "BUDGET_CREATED"
  | "BUDGET_REVISED"
  | "BUDGET_CLOSED"
  | "BUDGET_REQUEST_LOGGED"
  | "BUDGET_REQUEST_APPROVED"
  | "BUDGET_REQUEST_REJECTED"
  | "BUDGET_REQUEST_RETURNED"
  | "FUND_ALLOCATED"
  | "FUND_ALLOCATION_MODIFIED"
  | "EXPENSE_REQUEST_LOGGED"
  | "EXPENSE_REQUEST_APPROVED"
  | "EXPENSE_REQUEST_REJECTED"
  | "EXPENSE_REQUEST_RETURNED"
  | "PAYMENT_CREATED"
  | "PAYMENT_PROCESSED"
  | "PAYMENT_VERIFIED"
  | "PURCHASE_CLEARANCE_LOGGED"
  | "PURCHASE_CLEARANCE_APPROVED"
  | "PURCHASE_CLEARANCE_REJECTED"
  | "PURCHASE_CLEARANCE_RETURNED"
  | "PURCHASE_CLEARANCE_GOODS_PURCHASED"
  | "PURCHASE_CLEARANCE_GRN_UPLOADED"
  | "RECEIPT_RECORDED"
  | "RECEIPT_VERIFIED";

export const FINANCE_AUDIT_ACTION_LABELS: Record<FinanceAuditAction, string> = {
  BUDGET_CREATED: "Budget Created",
  BUDGET_REVISED: "Budget Revised",
  BUDGET_CLOSED: "Budget Closed",
  BUDGET_REQUEST_LOGGED: "Budget Request Logged",
  BUDGET_REQUEST_APPROVED: "Budget Request Approved",
  BUDGET_REQUEST_REJECTED: "Budget Request Rejected",
  BUDGET_REQUEST_RETURNED: "Budget Request Returned",
  FUND_ALLOCATED: "Fund Allocated",
  FUND_ALLOCATION_MODIFIED: "Fund Allocation Modified",
  EXPENSE_REQUEST_LOGGED: "Expense Request Logged",
  EXPENSE_REQUEST_APPROVED: "Expense Request Approved",
  EXPENSE_REQUEST_REJECTED: "Expense Request Rejected",
  EXPENSE_REQUEST_RETURNED: "Expense Request Returned",
  PAYMENT_CREATED: "Payment Created",
  PAYMENT_PROCESSED: "Payment Processed",
  PAYMENT_VERIFIED: "Payment Verified",
  PURCHASE_CLEARANCE_LOGGED: "Purchase Clearance Logged",
  PURCHASE_CLEARANCE_APPROVED: "Purchase Clearance Approved",
  PURCHASE_CLEARANCE_REJECTED: "Purchase Clearance Rejected",
  PURCHASE_CLEARANCE_RETURNED: "Purchase Clearance Returned",
  PURCHASE_CLEARANCE_GOODS_PURCHASED: "Purchase Clearance — Goods Purchased",
  PURCHASE_CLEARANCE_GRN_UPLOADED: "Purchase Clearance — GRN Uploaded",
  RECEIPT_RECORDED: "Receipt Recorded",
  RECEIPT_VERIFIED: "Receipt Verified",
};

export interface FinanceAuditLog {
  id: string;
  collegeId: string;
  action: FinanceAuditAction;
  performedBy: string;
  performedByName: string;
  targetId?: string;
  details?: Record<string, unknown>;
  timestamp: Timestamp;
}

// ─── Financial Reports (computed, not stored) ───────────────────────────────────

export type FinanceReportPeriod = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface FinanceReportSummary {
  period: FinanceReportPeriod;
  periodLabel: string;
  totalAllocated: number;
  totalUtilized: number;
  totalPayments: number;
  byDepartment: Record<string, { allocated: number; utilized: number }>;
  pendingApprovals: number;
  generatedAt: string;
}
