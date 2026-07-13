export type BudgetRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type BudgetRequestPriority = "High" | "Medium" | "Low";

export interface BudgetRequestItem {
  id: string;
  itemName: string;
  specification: string;
  quantity: number;
  unitPrice: number;
}

export interface BudgetRequest {
  id: string;
  department: string;
  requestedBy: string;
  category: string;
  title: string;
  priority: BudgetRequestPriority;
  requiredBefore: string;
  submittedDate: string;
  status: BudgetRequestStatus;
  items: BudgetRequestItem[];
}

function total(items: BudgetRequestItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export function requestAmount(request: BudgetRequest): number {
  return total(request.items);
}

// Placeholder data — the Principal Budget module is UI-only for now.
export const MOCK_BUDGET_REQUESTS: BudgetRequest[] = [
  {
    id: "BR-1001",
    department: "Computer Science",
    requestedBy: "HOD, Computer Science",
    category: "Lab Equipment",
    title: "GPU workstations for final-year AI lab",
    priority: "High",
    requiredBefore: "2026-08-15",
    submittedDate: "2026-07-01",
    status: "PENDING",
    items: [
      { id: "i1", itemName: "GPU Workstation", specification: "RTX 4070, 32GB RAM", quantity: 6, unitPrice: 95000 },
      { id: "i2", itemName: "UPS Backup", specification: "1kVA", quantity: 6, unitPrice: 6500 },
    ],
  },
  {
    id: "BR-1002",
    department: "Mechanical Engineering",
    requestedBy: "HOD, Mechanical Engineering",
    category: "Maintenance",
    title: "Annual maintenance of CNC machines",
    priority: "Medium",
    requiredBefore: "2026-09-01",
    submittedDate: "2026-06-28",
    status: "APPROVED",
    items: [
      { id: "i1", itemName: "CNC Servicing", specification: "Full servicing, 4 machines", quantity: 4, unitPrice: 12000 },
    ],
  },
  {
    id: "BR-1003",
    department: "Electronics & Communication",
    requestedBy: "HOD, Electronics & Communication",
    category: "Furniture",
    title: "Replacement lab benches",
    priority: "Low",
    requiredBefore: "2026-10-01",
    submittedDate: "2026-06-20",
    status: "REJECTED",
    items: [
      { id: "i1", itemName: "Lab Bench", specification: "Anti-static, 6-seater", quantity: 8, unitPrice: 15000 },
    ],
  },
  {
    id: "BR-1004",
    department: "Computer Science",
    requestedBy: "HOD, Computer Science",
    category: "Software",
    title: "MATLAB campus-wide license renewal",
    priority: "Medium",
    requiredBefore: "2026-08-01",
    submittedDate: "2026-07-05",
    status: "PENDING",
    items: [
      { id: "i1", itemName: "MATLAB License", specification: "Campus-wide, annual", quantity: 1, unitPrice: 250000 },
    ],
  },
];
