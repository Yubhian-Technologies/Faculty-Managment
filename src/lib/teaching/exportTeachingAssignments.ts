import ExcelJS from "exceljs";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { escapeHtml } from "@/lib/timetable/facultyTimetablePdf";

export interface TeachingAssignmentExportRow {
  courseName: string;
  year: number;
  sectionName: string;
  subjectCode?: string;
  subjectName: string;
  facultyName: string;
  hoursPerWeek: number;
}

export interface FacultyWorkloadExportRow {
  facultyName: string;
  designation?: string;
  department?: string;
  assignedSubjects: string;
  totalHours: number;
}

export interface UnstaffedGapExportRow {
  sectionName: string;
  subjectName: string;
  hoursPerWeek: number;
  subjectType?: string;
}

export interface TeachingAssignmentsExportOptions {
  departmentName: string;
  courseName?: string;
  yearLabel?: string;
  semesterLabel?: string;
  assignments: TeachingAssignmentExportRow[];
  facultyWorkload: FacultyWorkloadExportRow[];
  unstaffedGaps?: UnstaffedGapExportRow[];
}

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

export async function downloadTeachingAssignmentsXlsx(opts: TeachingAssignmentsExportOptions, filename: string): Promise<void> {
  const { departmentName, courseName, yearLabel, semesterLabel, assignments, facultyWorkload, unstaffedGaps = [] } = opts;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Faculty Management System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Teaching Assignments", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  sheet.getColumn(1).width = 8;  // S.No
  sheet.getColumn(2).width = 22; // Course / Section
  sheet.getColumn(3).width = 16; // Code
  sheet.getColumn(4).width = 30; // Subject Name
  sheet.getColumn(5).width = 28; // Faculty / Details
  sheet.getColumn(6).width = 14; // Hours/Wk

  let r = 1;
  const putTitle = (text: string, font: Partial<ExcelJS.Font>) => {
    const row = sheet.getRow(r);
    row.getCell(1).value = text;
    row.getCell(1).font = font;
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.mergeCells(r, 1, r, 6);
    row.height = (font.size ?? 11) * 1.8;
    r++;
  };

  putTitle("DEPARTMENT TEACHING ASSIGNMENTS & WORKLOAD ALLOCATION", { bold: true, size: 14 });
  const metaStr = [
    `DEPARTMENT: ${departmentName}`,
    courseName ? `COURSE: ${courseName}` : null,
    yearLabel ? `YEAR: ${yearLabel}` : null,
    semesterLabel ? `SEMESTER: ${semesterLabel}` : null,
  ].filter(Boolean).join("   |   ");
  putTitle(metaStr, { bold: true, size: 10 });
  r++; // spacer

  // 1. SECTION TEACHING ASSIGNMENTS
  const secTitle = sheet.getRow(r++);
  secTitle.getCell(1).value = "1. SECTION TEACHING ASSIGNMENTS";
  secTitle.getCell(1).font = { bold: true, size: 11 };
  sheet.mergeCells(r - 1, 1, r - 1, 6);

  const headerRow = sheet.getRow(r++);
  ["S.No", "Course & Section", "Subject Code", "Subject Name", "Assigned Faculty", "Hours/Wk"].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER;
  });
  headerRow.height = 22;

  if (assignments.length === 0) {
    const emptyRow = sheet.getRow(r++);
    emptyRow.getCell(1).value = "No teaching assignments recorded yet.";
    emptyRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    sheet.mergeCells(r - 1, 1, r - 1, 6);
    emptyRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    emptyRow.getCell(1).border = BORDER;
  } else {
    assignments.forEach((a, i) => {
      const row = sheet.getRow(r++);
      const vals = [
        i + 1,
        `${a.courseName} Yr ${a.year} - Sec ${a.sectionName}`,
        a.subjectCode ?? "—",
        a.subjectName,
        a.facultyName,
        a.hoursPerWeek,
      ];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: cIdx === 1 || cIdx === 3 || cIdx === 4 ? "left" : "center", vertical: "middle" };
        cell.border = BORDER;
      });
      row.height = 18;
    });
  }

  r += 2; // spacer

  // 2. FACULTY WORKLOAD SUMMARY
  const wlTitle = sheet.getRow(r++);
  wlTitle.getCell(1).value = "2. FACULTY WORKLOAD SUMMARY";
  wlTitle.getCell(1).font = { bold: true, size: 11 };
  sheet.mergeCells(r - 1, 1, r - 1, 6);

  const wlHeader = sheet.getRow(r++);
  ["S.No", "Faculty Name", "Designation", "Department", "Assigned Subjects & Sections", "Total Hours/Wk"].forEach((h, i) => {
    const cell = wlHeader.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER;
  });
  wlHeader.height = 22;

  if (facultyWorkload.length === 0) {
    const emptyRow = sheet.getRow(r++);
    emptyRow.getCell(1).value = "No faculty workload summary available.";
    emptyRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    sheet.mergeCells(r - 1, 1, r - 1, 6);
    emptyRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    emptyRow.getCell(1).border = BORDER;
  } else {
    facultyWorkload.forEach((f, i) => {
      const row = sheet.getRow(r++);
      const vals = [
        i + 1,
        f.facultyName,
        f.designation ?? "—",
        f.department ?? "—",
        f.assignedSubjects || "None",
        f.totalHours,
      ];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: cIdx === 1 || cIdx === 4 ? "left" : "center", vertical: "middle" };
        cell.border = BORDER;
      });
      row.height = 18;
    });
  }

  // 3. UNSTAFFED SUBJECT GAPS (If any)
  if (unstaffedGaps.length > 0) {
    r += 2; // spacer
    const gapTitle = sheet.getRow(r++);
    gapTitle.getCell(1).value = "3. UNSTAFFED SUBJECTS (STAFFING GAPS)";
    gapTitle.getCell(1).font = { bold: true, size: 11 };
    sheet.mergeCells(r - 1, 1, r - 1, 6);

    const gapHeader = sheet.getRow(r++);
    ["S.No", "Section", "Subject Name", "Type", "Status", "Hours/Wk"].forEach((h, i) => {
      const cell = gapHeader.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = BORDER;
    });
    gapHeader.height = 22;

    unstaffedGaps.forEach((g, i) => {
      const row = sheet.getRow(r++);
      const vals = [
        i + 1,
        g.sectionName,
        g.subjectName,
        g.subjectType ?? "Theory",
        "Unstaffed",
        g.hoursPerWeek,
      ];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: cIdx === 1 || cIdx === 2 ? "left" : "center", vertical: "middle" };
        cell.border = BORDER;
      });
      row.height = 18;
    });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadTeachingAssignmentsPdf(opts: TeachingAssignmentsExportOptions, filename: string): Promise<void> {
  const { departmentName, courseName, yearLabel, semesterLabel, assignments, facultyWorkload, unstaffedGaps = [] } = opts;

  const metaStr = [
    `DEPARTMENT: <strong>${escapeHtml(departmentName)}</strong>`,
    courseName ? `COURSE: <strong>${escapeHtml(courseName)}</strong>` : null,
    yearLabel ? `YEAR: <strong>${escapeHtml(yearLabel)}</strong>` : null,
    semesterLabel ? `SEMESTER: <strong>${escapeHtml(semesterLabel)}</strong>` : null,
  ].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");

  const assignmentsRows = assignments.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:8px;color:#666;font-style:italic">No teaching assignments recorded yet.</td></tr>`
    : assignments.map((a, i) => `
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #000;padding:4px"><strong>${escapeHtml(a.courseName)} Yr ${a.year} - Sec ${escapeHtml(a.sectionName)}</strong></td>
        <td style="border:1px solid #000;padding:4px;text-align:center">${escapeHtml(a.subjectCode ?? "—")}</td>
        <td style="border:1px solid #000;padding:4px"><strong>${escapeHtml(a.subjectName)}</strong></td>
        <td style="border:1px solid #000;padding:4px">${escapeHtml(a.facultyName)}</td>
        <td style="border:1px solid #000;padding:4px;text-align:center">${a.hoursPerWeek}</td>
      </tr>
    `).join("");

  const workloadRows = facultyWorkload.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:8px;color:#666;font-style:italic">No faculty workload summary available.</td></tr>`
    : facultyWorkload.map((f, i) => `
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #000;padding:4px"><strong>${escapeHtml(f.facultyName)}</strong></td>
        <td style="border:1px solid #000;padding:4px">${escapeHtml(f.designation ?? "—")}</td>
        <td style="border:1px solid #000;padding:4px">${escapeHtml(f.department ?? "—")}</td>
        <td style="border:1px solid #000;padding:4px">${escapeHtml(f.assignedSubjects || "None")}</td>
        <td style="border:1px solid #000;padding:4px;text-align:center"><strong>${f.totalHours}</strong></td>
      </tr>
    `).join("");

  const gapRows = unstaffedGaps.length === 0 ? "" : `
    <div style="margin-top:16px">
      <h3 style="font-size:10pt;font-weight:800;text-transform:uppercase;margin-bottom:4px;border-bottom:1.5px solid #000;padding-bottom:2px">3. Unstaffed Subjects (Staffing Gaps)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:8.5pt">
        <thead>
          <tr style="background:#f0f0f0">
            <th style="border:1px solid #000;padding:4px;width:35px">S.No</th>
            <th style="border:1px solid #000;padding:4px;text-align:left">Section</th>
            <th style="border:1px solid #000;padding:4px;text-align:left">Subject Name</th>
            <th style="border:1px solid #000;padding:4px;width:70px">Type</th>
            <th style="border:1px solid #000;padding:4px;width:80px">Status</th>
            <th style="border:1px solid #000;padding:4px;width:60px">Hours/Wk</th>
          </tr>
        </thead>
        <tbody>
          ${unstaffedGaps.map((g, i) => `
            <tr>
              <td style="border:1px solid #000;padding:4px;text-align:center">${i + 1}</td>
              <td style="border:1px solid #000;padding:4px">${escapeHtml(g.sectionName)}</td>
              <td style="border:1px solid #000;padding:4px"><strong>${escapeHtml(g.subjectName)}</strong></td>
              <td style="border:1px solid #000;padding:4px;text-align:center">${escapeHtml(g.subjectType ?? "Theory")}</td>
              <td style="border:1px solid #000;padding:4px;text-align:center;color:#b91c1c;font-weight:700">Unstaffed</td>
              <td style="border:1px solid #000;padding:4px;text-align:center">${g.hoursPerWeek}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Teaching Assignments - ${escapeHtml(departmentName)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #000; font-size: 10pt; line-height: 1.3; }
    .header { border: 2px solid #000; padding: 8px 12px; text-align: center; margin-bottom: 12px; }
    .title { font-size: 14pt; font-weight: 900; text-transform: uppercase; margin-bottom: 4px; }
    .meta { font-size: 9pt; font-weight: 600; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 14px; }
    th { background: #f0f0f0; border: 1px solid #000; padding: 4px; font-weight: 800; text-align: left; }
    td { border: 1px solid #000; padding: 4px; }
    h3 { font-size: 10pt; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1.5px solid #000; padding-bottom: 2px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">Department Teaching Assignments &amp; Workload Allocation</div>
    <div class="meta">${metaStr}</div>
  </div>

  <h3>1. Section Teaching Assignments</h3>
  <table>
    <thead>
      <tr>
        <th style="width:35px;text-align:center">S.No</th>
        <th>Course &amp; Section</th>
        <th style="width:80px;text-align:center">Subject Code</th>
        <th>Subject Name</th>
        <th>Assigned Faculty</th>
        <th style="width:65px;text-align:center">Hours/Wk</th>
      </tr>
    </thead>
    <tbody>
      ${assignmentsRows}
    </tbody>
  </table>

  <h3>2. Faculty Workload Summary</h3>
  <table>
    <thead>
      <tr>
        <th style="width:35px;text-align:center">S.No</th>
        <th>Faculty Name</th>
        <th>Designation</th>
        <th>Department</th>
        <th>Assigned Subjects &amp; Sections</th>
        <th style="width:75px;text-align:center">Total Hours/Wk</th>
      </tr>
    </thead>
    <tbody>
      ${workloadRows}
    </tbody>
  </table>

  ${gapRows}
</body>
</html>`;

  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
