import type { Timestamp } from "firebase/firestore";
import { NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES } from "./budget";

// ─── Indent Request (HOD → Purchase Department → Finance) ─────────────────────
// Cross-role type: lives outside finance.ts (which stays Finance-internal only).
// HOD raises an indent against an approved department budget line; Purchase
// Department sources >=3 vendor quotations and recommends one; Finance reviews
// and disburses (auto-creating a FinancePayment) — the "green flag".

// The category an indent is raised against — reuses the same budget category
// list HODs pick from when submitting a budget request, so Purchase Dept can
// view indents grouped the same way Finance groups budget line items.
export const INDENT_CATEGORIES = Array.from(
  new Set<string>([...NON_RECURRING_CATEGORIES, ...RECURRING_CATEGORIES])
);

// Suggests Goods/Non-Goods from the chosen category (Non-Recurring categories
// are physical procurement; Recurring ones are typically services/honoraria).
// Only a default for the form — the HOD can override it either way.
const NON_RECURRING_SET = new Set<string>(NON_RECURRING_CATEGORIES);
export function defaultIndentRequestType(category: string): "GOODS" | "NON_GOODS" {
  return NON_RECURRING_SET.has(category) ? "GOODS" : "NON_GOODS";
}

// GOODS indents go through Purchase Dept for vendor-quotation sourcing before
// Finance disburses. NON_GOODS indents (services, honoraria, staff-facing
// spend with no physical procurement) skip Purchase Dept entirely and go
// straight to Finance for direct approval — the "regular flow".
export type IndentRequestType = "GOODS" | "NON_GOODS";

export const INDENT_REQUEST_TYPE_LABELS: Record<IndentRequestType, string> = {
  GOODS: "Goods",
  NON_GOODS: "Non-Goods",
};

export type IndentStatus =
  | "PENDING_PURCHASE_REVIEW" // GOODS only: HOD submitted; awaiting Purchase Dept
  | "REJECTED_BY_PURCHASE"    // terminal (GOODS only)
  | "RETURNED_TO_HOD"         // Purchase Dept (GOODS) or Finance (NON_GOODS) sent back; HOD edits + resubmits
  | "PENDING_FINANCE_REVIEW"  // GOODS: Purchase Dept forwarded with >=3 quotations + 1 selected. NON_GOODS: HOD submitted directly.
  | "RETURNED_TO_PURCHASE"    // GOODS only: Finance sent back; Purchase Dept revises quotations + resubmits
  | "REJECTED"                // terminal (Finance)
  | "APPROVED"                // GOODS only: FinancePayment auto-created ("green flag"); Purchase Dept can now buy the goods
  | "COMPLETED";              // terminal; GOODS: Purchase Dept bought the goods and uploaded the receipt. NON_GOODS: Finance approved & disbursed directly.

export const INDENT_STATUS_LABELS: Record<IndentStatus, string> = {
  PENDING_PURCHASE_REVIEW: "Pending Purchase Review",
  REJECTED_BY_PURCHASE: "Rejected by Purchase Dept",
  RETURNED_TO_HOD: "Returned to HOD",
  PENDING_FINANCE_REVIEW: "Pending Finance Review",
  RETURNED_TO_PURCHASE: "Returned to Purchase Dept",
  REJECTED: "Rejected by Finance",
  APPROVED: "Approved — Ready to Purchase",
  COMPLETED: "Completed",
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
  category: string;
  requestType: IndentRequestType;
  items: IndentItem[];
  status: IndentStatus;
  quotations: IndentQuotation[]; // Purchase Dept fills in, min 3 before forwarding to Finance
  selectedQuotationId?: string;  // Purchase Dept's recommended vendor
  history: IndentApprovalAction[];
  financePaymentId?: string;     // set once Finance approves
  receiptUrl?: string;           // set once Purchase Dept buys the goods and uploads a bill
  receiptFileName?: string;
  receiptAmount?: number;        // actual amount paid, may differ slightly from the quoted price
  receiptUploadedBy?: string;
  receiptUploadedByName?: string;
  receiptUploadedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
