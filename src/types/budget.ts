import type { Timestamp } from "firebase/firestore";

// ─── Budget Request (HOD → Principal L1 verification → Finance) ───────────────
// Cross-role type: lives outside finance.ts (which stays Finance-internal only).

export type BudgetRequestStatus =
  | "PENDING_PRINCIPAL_VERIFICATION" // HOD submitted, awaiting Principal
  | "RETURNED_TO_HOD"                // Principal or Finance sent it back; HOD can edit + resubmit
  | "L1_FROZEN"                      // Principal verified & locked; queued for Finance
  | "PRINCIPAL_REJECTED"             // terminal
  | "FINANCE_APPROVED"               // terminal; FinanceBudget auto-created
  | "FINANCE_REJECTED";              // terminal

export const BUDGET_REQUEST_STATUS_LABELS: Record<BudgetRequestStatus, string> = {
  PENDING_PRINCIPAL_VERIFICATION: "Pending Principal Verification",
  RETURNED_TO_HOD: "Returned to HOD",
  L1_FROZEN: "Level 1 Freeze",
  PRINCIPAL_REJECTED: "Rejected by Principal",
  FINANCE_APPROVED: "Approved by Finance",
  FINANCE_REJECTED: "Rejected by Finance",
};

export type BudgetRequestPriority = "High" | "Medium" | "Low";

export const BUDGET_CATEGORIES = [
  "Lab Equipment",
  "Furniture",
  "Software",
  "Infrastructure",
  "Maintenance",
  "Events",
  "Research",
  "Training",
  "Library",
  "Electrical",
  "Networking",
  "Other",
] as const;

export interface BudgetRequestItem {
  id: string;
  itemName: string;
  specification: string;
  quantity: number;
  unitPrice: number;
}

export interface BudgetApprovalAction {
  action: BudgetRequestStatus;
  byRole: "HOD" | "PRINCIPAL" | "VICE_PRINCIPAL" | "FINANCE";
  byUid: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
}

export interface BudgetRequest {
  id: string;
  collegeId: string;
  hodUid: string;
  hodName: string;
  department: string;
  category: string;
  title: string;
  priority: BudgetRequestPriority;
  requiredBefore?: string; // ISO date string
  items: BudgetRequestItem[];
  status: BudgetRequestStatus;
  history: BudgetApprovalAction[];
  financeBudgetId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export function budgetRequestTotal(items: BudgetRequestItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
