import ExcelJS from "exceljs";
import type { FinanceReportSummary } from "@/types";

export async function exportFinanceReportExcel(report: FinanceReportSummary): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 20 },
  ];
  summarySheet.addRows([
    { metric: "Period", value: report.periodLabel || report.period },
    { metric: "Total Allocated", value: report.totalAllocated },
    { metric: "Total Utilized", value: report.totalUtilized },
    { metric: "Total Payments", value: report.totalPayments },
    { metric: "Pending Approvals", value: report.pendingApprovals },
    { metric: "Generated At", value: new Date(report.generatedAt).toLocaleString("en-IN") },
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const deptSheet = workbook.addWorksheet("By Department");
  deptSheet.columns = [
    { header: "Department", key: "department", width: 30 },
    { header: "Allocated", key: "allocated", width: 20 },
    { header: "Utilized", key: "utilized", width: 20 },
    { header: "Remaining", key: "remaining", width: 20 },
  ];
  for (const [department, values] of Object.entries(report.byDepartment)) {
    deptSheet.addRow({
      department,
      allocated: values.allocated,
      utilized: values.utilized,
      remaining: values.allocated - values.utilized,
    });
  }
  deptSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-report-${report.period.toLowerCase()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
