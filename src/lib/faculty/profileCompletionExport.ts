// xlsx export for the Faculty Profile Completion report - client-side
// workbook build + browser download, same pattern as every other exceljs
// export in this codebase (see src/lib/finance/exportExcel.ts). One row per
// faculty, one column per section's % alongside the overall %, so the
// section-wise breakdown the UI shows per-row is also in the downloaded file.
import ExcelJS from "exceljs";
import type { CompletionModuleKey } from "@/lib/faculty/profileCompletion";

export interface ProfileCompletionExportRow {
  employeeId?: string;
  name: string;
  department?: string;
  designation?: string;
  status?: string;
  overallPercent: number;
  sections: { key: CompletionModuleKey; label: string; percent: number; isComplete: boolean }[];
}

function sectionCell(percent: number, isComplete: boolean): string {
  return isComplete ? "Filled" : `${percent}%`;
}

export async function exportFacultyProfileCompletionExcel(
  rows: ProfileCompletionExportRow[],
  sectionDefs: { key: CompletionModuleKey; label: string }[],
  filenameSuffix: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Profile Completion");

  sheet.columns = [
    { header: "Employee ID", key: "employeeId", width: 16 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "department", width: 22 },
    { header: "Designation", key: "designation", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Overall Completion", key: "overallPercent", width: 18 },
    ...sectionDefs.map((s) => ({ header: s.label, key: s.key, width: 20 })),
  ];

  for (const row of rows) {
    const bySection = new Map(row.sections.map((s) => [s.key, s]));
    sheet.addRow({
      employeeId: row.employeeId ?? "",
      name: row.name,
      department: row.department ?? "",
      designation: row.designation ?? "",
      status: row.status ?? "",
      overallPercent: `${row.overallPercent}%`,
      ...Object.fromEntries(
        sectionDefs.map((s) => {
          const section = bySection.get(s.key);
          return [s.key, section ? sectionCell(section.percent, section.isComplete) : ""];
        })
      ),
    });
  }
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `faculty_profile_completion_${filenameSuffix}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
