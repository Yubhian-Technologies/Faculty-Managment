import type { Timestamp } from "firebase/firestore";

// ─── Indent Request (HOD → Purchase Department → Finance) ─────────────────────
// Cross-role type: lives outside finance.ts (which stays Finance-internal only).
// HOD raises an indent against an approved department budget line; Purchase
// Department sources >=3 vendor quotations and recommends one; Finance reviews
// and disburses (auto-creating a FinancePayment) — the "green flag".

export type IndentStatus =
  | "PENDING_PURCHASE_REVIEW" // HOD submitted; awaiting Purchase Dept
  | "REJECTED_BY_PURCHASE"    // terminal
  | "RETURNED_TO_HOD"         // Purchase Dept sent back; HOD edits + resubmits
  | "PENDING_FINANCE_REVIEW"  // Purchase Dept forwarded with >=3 quotations + 1 selected
  | "RETURNED_TO_PURCHASE"    // Finance sent back; Purchase Dept revises quotations + resubmits
  | "REJECTED"                // terminal (Finance)
  | "APPROVED";                // terminal; FinancePayment auto-created ("green flag")

export const INDENT_STATUS_LABELS: Record<IndentStatus, string> = {
  PENDING_PURCHASE_REVIEW: "Pending Purchase Review",
  REJECTED_BY_PURCHASE: "Rejected by Purchase Dept",
  RETURNED_TO_HOD: "Returned to HOD",
  PENDING_FINANCE_REVIEW: "Pending Finance Review",
  RETURNED_TO_PURCHASE: "Returned to Purchase Dept",
  REJECTED: "Rejected by Finance",
  APPROVED: "Approved & Disbursed",
};

// ─── Line Items ─────────────────────────────────────────────────────────────

export interface IndentItem {
  id: string;
  description: string;
  quantity: number;
  estimatedUnitPrice: number;
}

export function indentItemTotal(item: IndentItem): number {
  return (item.quantity || 0) * (item.estimatedUnitPrice || 0);
}

export function indentItemsTotal(items: IndentItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + indentItemTotal(item), 0);
}

// ─── Quotations ─────────────────────────────────────────────────────────────

export interface IndentQuotation {
  id: string;
  vendorName: string;
  termsAndConditions: string;
  price: number;
  expectedDeliveryDate: string; // ISO date
}

// ─── Approval History ───────────────────────────────────────────────────────

export interface IndentApprovalAction {
  action: IndentStatus;
  byRole: "HOD" | "PURCHASE_DEPT" | "FINANCE";
  byUid: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
}

// ─── Indent Request ─────────────────────────────────────────────────────────

export interface IndentRequest {
  id: string;
  collegeId: string;
  hodUid: string;
  hodName: string;
  department: string;
  title: string;
  items: IndentItem[];
  status: IndentStatus;
  quotations: IndentQuotation[]; // Purchase Dept fills in, min 3 before forwarding to Finance
  selectedQuotationId?: string;  // Purchase Dept's recommended vendor
  history: IndentApprovalAction[];
  financePaymentId?: string;     // set once Finance approves
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
