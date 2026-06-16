import type { Timestamp } from "firebase/firestore";
import type { Designation, EmploymentType } from "./core";

// ─── Salary Structure (template per designation/employment type) ───────────────
// Accounts/Principal create these; used to pre-fill monthly payroll

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

// ─── Monthly Salary Record ────────────────────────────────────────────────────
// One document per faculty per month; populated from attendance summary + structure

export type PayrollStatus =
  | "DRAFT"
  | "PROCESSED"
  | "HOD_VERIFIED"
  | "PRINCIPAL_APPROVED"
  | "PAID"
  | "HELD";

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  PROCESSED: "Processed",
  HOD_VERIFIED: "HOD Verified",
  PRINCIPAL_APPROVED: "Approved",
  PAID: "Paid",
  HELD: "On Hold",
};

export interface SalaryRecord {
  id: string;                   // `${facultyId}_${year}_${month}`
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  designation: Designation;
  salaryStructureId?: string;
  year: number;
  month: number;                // 1–12
  workingDays: number;          // total working days in month
  presentDays: number;          // days present (incl. on-duty)
  lossOfPayDays: number;        // absent without sanctioned leave
  earnings: {
    basic: number;
    hra: number;
    da: number;
    ta: number;
    medicalAllowance: number;
    otherAllowances: number;
    arrears: number;            // salary arrears from back-dated revision
    totalEarnings: number;
  };
  deductions: {
    employeePf: number;
    professionalTax: number;
    tds: number;
    lossOfPay: number;
    advanceRecovery: number;
    otherDeductions: number;
    totalDeductions: number;
  };
  employerPf: number;           // cost to institution, not a deduction from employee
  netSalary: number;
  status: PayrollStatus;
  processedBy?: string;
  processedAt?: Timestamp;
  hodVerifiedBy?: string;
  hodVerifiedAt?: Timestamp;
  approvedBy?: string;
  approvedAt?: Timestamp;
  paidAt?: Timestamp;
  paymentMode?: "BANK_TRANSFER" | "CHEQUE" | "CASH";
  payslipUrl?: string;
  remarks?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Salary Advance ───────────────────────────────────────────────────────────

export type AdvanceStatus = "PENDING" | "APPROVED" | "REJECTED" | "REPAID";

export interface SalaryAdvance {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  amount: number;
  reason: string;
  repaymentMonths?: number;     // number of months for EMI recovery
  monthlyRecovery?: number;     // amount to recover per month
  status: AdvanceStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp;
  repaidAmount: number;
  fullyRepaidAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Payroll Run (batch processing record) ────────────────────────────────────

export interface PayrollRun {
  id: string;
  collegeId: string;
  year: number;
  month: number;
  totalFaculty: number;
  totalAmount: number;
  status: "DRAFT" | "PROCESSED" | "APPROVED" | "PAID";
  processedBy: string;
  processedAt: Timestamp;
  approvedBy?: string;
  approvedAt?: Timestamp;
  paidAt?: Timestamp;
  remarks?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
