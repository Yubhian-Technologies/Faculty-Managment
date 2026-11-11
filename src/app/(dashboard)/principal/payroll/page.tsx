"use client";

import { PayrollHome } from "@/components/payroll/PayrollHome";

// Principal / Vice Principal > Payroll: the college's monthly salaries, read only.
export default function PrincipalPayrollPage() {
  return <PayrollHome pickCollege={false} viewOnly />;
}
