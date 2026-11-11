"use client";

import { PayrollHome } from "@/components/payroll/PayrollHome";

// College Office > Payroll: the college's pay structures and rules (read only - Accounts maintain them).
export default function CollegeOfficePayrollPage() {
  return <PayrollHome pickCollege={false} />;
}
