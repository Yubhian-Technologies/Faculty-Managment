import type { PayslipData } from "@/lib/payroll/payslip";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { getPayslipHTML } from "@/lib/pdf/payslipTemplate";

/** Builds a payslip PDF in the browser from the server's payslip data. */
export async function downloadPayslip(p: PayslipData) {
  const name = `Payslip_${p.month}_${(p.person.employeeCode || p.person.name).replace(/[^a-zA-Z0-9-]+/g, "-")}.pdf`;
  await renderHtmlToPdf(getPayslipHTML(p), name, { fitOnePage: true });
}
