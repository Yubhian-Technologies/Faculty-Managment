import type { Timestamp } from "firebase/firestore";

// ─── Budget Request (HOD → Principal L1 verification → Finance) ───────────────
// Cross-role type: lives outside finance.ts (which stays Finance-internal only).

export type BudgetRequestStatus =
  | "PENDING_PRINCIPAL_VERIFICATION" // HOD submitted, awaiting Principal
  | "RETURNED_TO_HOD"                // Principal or Finance sent it back; HOD can edit + resubmit
  | "L1_FROZEN"                      // Principal verified & locked; queued for Finance
  | "PRINCIPAL_REJECTED"             // terminal
  | "FINANCE_APPROVED"               // terminal; FinanceBudget auto-created
  | "FINANCE_REJECTED"               // terminal
  // Emergency requests (Principal/VP → Management → Finance) — see isEmergency below
  | "PENDING_MANAGEMENT_APPROVAL"    // Principal/VP submitted, awaiting Management
  | "RETURNED_TO_PRINCIPAL"          // Management or Finance sent it back; owner can edit + resubmit
  | "MANAGEMENT_REJECTED";           // terminal

export const BUDGET_REQUEST_STATUS_LABELS: Record<BudgetRequestStatus, string> = {
  PENDING_PRINCIPAL_VERIFICATION: "Pending Principal Verification",
  RETURNED_TO_HOD: "Returned to HOD",
  L1_FROZEN: "Level 1 Freeze",
  PRINCIPAL_REJECTED: "Rejected by Principal",
  FINANCE_APPROVED: "Approved by Finance",
  FINANCE_REJECTED: "Rejected by Finance",
  PENDING_MANAGEMENT_APPROVAL: "Pending Management Approval",
  RETURNED_TO_PRINCIPAL: "Returned to Requester",
  MANAGEMENT_REJECTED: "Rejected by Management",
};

export const NON_RECURRING_CATEGORIES = [
  "Lab Equipment",
  "Other Equipment",
  "Furniture",
  "Other",
] as const;

export const RECURRING_CATEGORIES = [
  "Staff Salaries",
  "Workshops/Seminars/Paper Presentations",
  "Guest Faculty/Guest Lectures",
  "Department Forum's Activities",
  "Inhouse R&D Activities",
  "Equipment Maintenance & Consumables",
  "Printing & Stationery",
  "Miscellaneous/Unforeseen Items",
  "Other",
] as const;

export interface BudgetRequestItem {
  id: string;
  title: string;
  description: string;
  price: number;
  extras: Record<string, string>; // values for category-defined fields + this item's own customFields
  customFields?: BudgetExtraFieldDef[]; // ad-hoc fields the HOD added for this item only, via "+ Add Field"
}

export interface BudgetCategoryGroup {
  id: string;
  category: string;
  items: BudgetRequestItem[];
}

export interface BudgetApprovalAction {
  action: BudgetRequestStatus;
  byRole: "HOD" | "PRINCIPAL" | "VICE_PRINCIPAL" | "FINANCE" | "MANAGEMENT";
  byUid: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
}

// Goods vs Non-Goods classification for emergency requests — derived server-side
// from which section (Non-Recurring vs Recurring) the request's items live in.
export type EmergencyRequestType = "GOODS" | "NON_GOODS";

export interface BudgetRequest {
  id: string;
  collegeId: string;
  hodUid: string;
  hodName: string;
  department: string;
  academicYear: string;
  title: string;
  requestDate: string; // ISO date-time string — defaults to submission time
  nonRecurring: BudgetCategoryGroup[];
  recurring: BudgetCategoryGroup[];
  status: BudgetRequestStatus;
  history: BudgetApprovalAction[];
  financeBudgetId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // ─── Emergency request (Principal/VP → Management → Finance) ─────────────
  isEmergency?: boolean;
  emergencyReason?: string;
  emergencyType?: EmergencyRequestType;
  // Non-Goods emergency requests only: a report Finance attaches after approval,
  // visible to the requesting Principal/VP for viewing only.
  reportFileUrl?: string;
  reportFileName?: string;
  reportUploadedBy?: string;
  reportUploadedByName?: string;
  reportUploadedAt?: Timestamp;
}

export function categoryGroupTotal(group: BudgetCategoryGroup): number {
  return (group.items ?? []).reduce((sum, item) => sum + itemTotal(item, group.category), 0);
}

export function sectionTotal(groups: BudgetCategoryGroup[] | undefined): number {
  return (groups ?? []).reduce((sum, group) => sum + categoryGroupTotal(group), 0);
}

export function budgetRequestTotal(req: Pick<BudgetRequest, "nonRecurring" | "recurring">): number {
  return sectionTotal(req.nonRecurring) + sectionTotal(req.recurring);
}

// ─── Category-driven dynamic item fields ───────────────────────────────────
// Every item always carries a base set (title, description, price); each
// category can additionally declare its own extra fields (e.g. Quantity +
// Specification for Lab Equipment, Number of Staff for Staff Salaries), so
// the item-entry form adapts to whatever a given category actually needs.

export type BudgetExtraFieldType = "TEXT" | "NUMBER";

export interface BudgetExtraFieldDef {
  key: string; // e.g. "quantity", "specification", "numberOfStaff"
  label: string;
  type: BudgetExtraFieldType;
  placeholder?: string;
  isMultiplier?: boolean; // numeric extra field that multiplies with price for the item total
}

export interface BudgetCategoryFieldConfig {
  extraFields: BudgetExtraFieldDef[];
  fixedTotalMultiplier?: number; // e.g. 12 for Staff Salaries (Price × 12), overrides any multiplier extra field
  priceLabel?: string; // defaults to "Unit Price" if a multiplier field exists, else "Amount"
  totalLabel?: string; // defaults to "Total"
}

const QUANTITY_FIELD: BudgetExtraFieldDef = { key: "quantity", label: "Quantity", type: "NUMBER", isMultiplier: true, placeholder: "1" };

export const CATEGORY_FIELD_CONFIG: Record<string, BudgetCategoryFieldConfig> = {
  "Lab Equipment": { extraFields: [QUANTITY_FIELD, { key: "specification", label: "Specification", type: "TEXT", placeholder: "e.g. 100MHz, 4-channel" }] },
  "Other Equipment": { extraFields: [QUANTITY_FIELD, { key: "justification", label: "Justification", type: "TEXT", placeholder: "e.g. For new staff room" }] },
  "Furniture": { extraFields: [QUANTITY_FIELD, { key: "justification", label: "Justification", type: "TEXT" }] },
  "Printing & Stationery": { extraFields: [QUANTITY_FIELD] },
  "Guest Faculty/Guest Lectures": { extraFields: [{ ...QUANTITY_FIELD, label: "Number of Lectures" }] },
  "Inhouse R&D Activities": { extraFields: [QUANTITY_FIELD] },
  "Workshops/Seminars/Paper Presentations": { extraFields: [] },
  "Department Forum's Activities": { extraFields: [] },
  "Equipment Maintenance & Consumables": { extraFields: [] },
  "Miscellaneous/Unforeseen Items": { extraFields: [] },
  // "Other"/custom categories: no entry → falls back to base fields only.
};

export function fieldConfigForCategory(category: string): BudgetCategoryFieldConfig {
  return CATEGORY_FIELD_CONFIG[category] ?? { extraFields: [] };
}

export function itemTotal(item: BudgetRequestItem, category: string): number {
  const cfg = fieldConfigForCategory(category);
  if (cfg.fixedTotalMultiplier) return item.price * cfg.fixedTotalMultiplier;

  // A per-item ad-hoc field marked "use for total" takes precedence over the
  // category's own multiplier field (e.g. Quantity) when the HOD opts into one.
  const customMultiplierField = (item.customFields ?? []).find((f) => f.isMultiplier);
  if (customMultiplierField) {
    return item.price * (Number(item.extras[customMultiplierField.key]) || 1);
  }

  const multiplierField = cfg.extraFields.find((f) => f.isMultiplier);
  const multiplier = multiplierField ? Number(item.extras[multiplierField.key]) || 1 : 1;
  return item.price * multiplier;
}

// When a group's category changes, keep extras values for keys still valid
// under the new category (or belonging to the item's own ad-hoc customFields,
// which persist across category changes since they're item-level, not
// category-level) and drop/blank the rest.
export function reconcileExtrasForCategory(items: BudgetRequestItem[], category: string): BudgetRequestItem[] {
  const validKeys = fieldConfigForCategory(category).extraFields.map((f) => f.key);
  return items.map((item) => {
    const extras: Record<string, string> = {};
    for (const key of validKeys) extras[key] = item.extras[key] ?? "";
    for (const f of item.customFields ?? []) extras[f.key] = item.extras[f.key] ?? "";
    return { ...item, extras };
  });
}

// Docs created before the Recurring/Non-Recurring restructure don't have these
// fields — default them so every consumer can assume the arrays always exist.
export function normalizeBudgetRequest<T extends { nonRecurring?: BudgetCategoryGroup[]; recurring?: BudgetCategoryGroup[] }>(
  req: T
): T & { nonRecurring: BudgetCategoryGroup[]; recurring: BudgetCategoryGroup[] } {
  return { ...req, nonRecurring: req.nonRecurring ?? [], recurring: req.recurring ?? [] };
}
