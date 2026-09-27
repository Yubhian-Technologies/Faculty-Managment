import type { DayOfWeek, PeriodTiming, Section, Subject, TeachingAssignment, TimetableSlot } from "@/types";
import { escapeHtml, formatTime12h } from "./facultyTimetablePdf";

export interface SectionTimetablePdfOptions {
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
  departmentName?: string;
  academicYear?: string;
  semesterLabel?: string;
  regulation?: string;
  section?: Partial<Section> & { name?: string; department?: string; year?: number; courseName?: string };
  courseName?: string;
  classroom?: string;
  classInchargeName?: string;
  effectiveDate?: string;
  days: DayOfWeek[];
  periods: number[];
  periodTimings: PeriodTiming[];
  slots: TimetableSlot[];
  subjects?: Subject[];
  assignments?: TeachingAssignment[];
  lunchBreak?: { afterPeriod: number; durationMinutes: number };
  shortBreaks?: { afterPeriod: number; durationMinutes: number }[];
}

export const VISHNU_LOGO_SVG = `<svg width="95" height="90" viewBox="0 0 120 110" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M25 20 L55 80 L70 50 L45 20 Z" fill="#E65100"/>
  <path d="M45 20 L70 50 L95 20 L70 20 Z" fill="#2E7D32"/>
  <path d="M55 80 L70 50 L85 80 Z" fill="#1565C0"/>
  <text x="60" y="96" font-family="Arial, sans-serif" font-size="10" font-weight="900" text-anchor="middle" fill="#222">VISHNU</text>
  <text x="60" y="105" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" letter-spacing="0.5" text-anchor="middle" fill="#666">UNIVERSAL LEARNING</text>
</svg>`;

export function buildSectionTimetablePdfHtml(opts: SectionTimetablePdfOptions): string {
  const {
    collegeName = "College Name",
    collegeCode = "",
    affiliation = "",
    address = "",
    phone = "",
    logoUrl,
    days,
    periods,
    periodTimings,
    slots,
    subjects = [],
    assignments = [],
    lunchBreak,
    shortBreaks,
  } = opts;

  // Resolve lunch break position (default after period 4)
  const lunchAfter = lunchBreak?.afterPeriod ?? (periods.length >= 6 ? 4 : Math.floor(periods.length / 2));
  // Resolve short breaks
  const shortBreakAfters = new Set(shortBreaks?.map((b) => b.afterPeriod) ?? (periods.length >= 8 ? [2] : []));

  // Map period timing by period number
  const timingByPeriod = new Map<number, PeriodTiming>();
  for (const t of periodTimings) timingByPeriod.set(t.period, t);

  // Group columns definition
  interface ColumnDef {
    kind: "period" | "break";
    periodNumber?: number;
    title: string;
    subText?: string;
    widthPercent: number;
  }

  const columns: ColumnDef[] = [];
  // Day of week column
  columns.push({
    kind: "period",
    title: "Day of<br>week",
    widthPercent: 7.5,
  });

  for (const p of periods) {
    const t = timingByPeriod.get(p);
    const startStr = t ? formatTime12h(t.startTime) : "";
    const endStr = t ? formatTime12h(t.endTime) : "";

    columns.push({
      kind: "period",
      periodNumber: p,
      title: `Period ${p}<br>${startStr}<br>${endStr}`,
      widthPercent: 9.5,
    });

    // Check if short break occurs after this period
    if (shortBreakAfters.has(p)) {
      const nextT = timingByPeriod.get(p + 1);
      const breakStart = endStr || "10:40 AM";
      const breakEnd = nextT ? formatTime12h(nextT.startTime) : "11:00 AM";
      columns.push({
        kind: "break",
        title: `${breakStart}<br>${breakEnd}`,
        widthPercent: 7.5,
      });
    }

    // Check if lunch break occurs after this period
    if (p === lunchAfter) {
      const nextT = timingByPeriod.get(p + 1);
      const lunchStart = endStr || "12:40 PM";
      const lunchEnd = nextT ? formatTime12h(nextT.startTime) : "01:40 PM";
      columns.push({
        kind: "break",
        title: `${lunchStart}<br>${lunchEnd}`,
        widthPercent: 8.5,
      });
    }
  }

  // Build Table Header
  const headerHtml = `<tr style="background-color: #ffffff;">
    ${columns
      .map(
        (col) =>
          `<th class="cellBorder" style="width:${col.widthPercent}%;font-weight:bold;font-size:9.5px;line-height:1.25;padding:4px 2px;background:#ffffff;">${col.title}</th>`
      )
      .join("")}
  </tr>`;

  // Map subjects
  const subjectMap = new Map<string, Subject>();
  for (const s of subjects) subjectMap.set(s.id, s);

  // Helper for short code: e.g. DWDM, FLAT, CN, etc.
  function getSlotShortCode(slot: TimetableSlot): string {
    const sObj = subjectMap.get(slot.subjectId);
    if (sObj?.shortCode) return sObj.shortCode;
    if (sObj?.code) return sObj.code;
    if ((slot as any).shortCode) return (slot as any).shortCode;
    if ((slot as any).subjectCode) return (slot as any).subjectCode;
    // Derive abbreviation if subject name is long
    const name = slot.subjectName || "";
    if (name.length <= 10) return name.toUpperCase();
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Day rows
  const DAY_SHORT: Record<DayOfWeek, string> = {
    MON: "Mon",
    TUE: "Tue",
    WED: "Wed",
    THU: "Thu",
    FRI: "Fri",
    SAT: "Sat",
  };

  const rowsHtml = days
    .map((d) => {
      const dayLabel = DAY_SHORT[d] ?? d;
      const cells: string[] = [];

      // Day name column
      cells.push(`<td class="cellBorder" style="font-weight:500;">${dayLabel}</td>`);

      for (let i = 1; i < columns.length; i++) {
        const col = columns[i];
        if (col.kind === "break") {
          cells.push(`<td class="cellBorder break-cell">&nbsp;</td>`);
        } else if (col.periodNumber != null) {
          const slot = slots.find((s) => s.day === d && s.periodNumber === col.periodNumber);
          if (!slot) {
            cells.push(`<td class="cellBorder">&nbsp;</td>`);
          } else {
            const shortCode = getSlotShortCode(slot);
            cells.push(`<td class="cellBorder" style="font-weight:500;">${escapeHtml(shortCode)}</td>`);
          }
        }
      }

      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  // Build Allocation of Subjects Table
  const seenSubj = new Set<string>();
  interface AllocationRow {
    code: string;
    name: string;
    faculty: string;
  }
  const allocationRows: AllocationRow[] = [];

  for (const slot of slots) {
    const key = slot.subjectId || slot.subjectName;
    if (!key || seenSubj.has(key)) continue;
    seenSubj.add(key);

    const sObj = subjectMap.get(slot.subjectId);
    const assign = assignments.find((a) => a.subjectId === slot.subjectId);

    const code = sObj?.shortCode ?? sObj?.code ?? getSlotShortCode(slot);
    const name = sObj?.name ?? slot.subjectName;
    const fac = (slot.facultyName ?? assign?.facultyName ?? "Unassigned").toUpperCase();

    allocationRows.push({ code, name, faculty: fac });
  }

  const allocationTableHtml = allocationRows
    .map(
      (r) => `<tr>
      <td align="left" class="cellBorder">${escapeHtml(r.code)}</td>
      <td align="left" class="cellBorder">${escapeHtml(r.name)}</td>
      <td align="left" class="cellBorder">${escapeHtml(r.faculty)}</td>
      <td align="left" class="cellBorder">&nbsp;</td>
    </tr>`
    )
    .join("");

  // Logo Markup
  const logoTd = logoUrl
    ? `<td style="width: 105px; vertical-align: middle; text-align: center;"><img src="${escapeHtml(logoUrl)}" border="0" width="95px" height="85px" style="object-fit:contain;" alt="Logo"></td>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TIME TABLE - ${escapeHtml(collegeName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm 8mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #000000;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.25;
      padding: 10px;
    }
    .reportMainHeading {
      font-size: 13.5px;
      font-weight: bold;
      color: #000;
      letter-spacing: 0.3px;
    }
    .reportHeading1 {
      font-size: 11px;
      font-weight: bold;
      color: #000;
    }
    .cellBorder {
      border: 1px solid #000000;
      padding: 4px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 10px;
    }
    th.cellBorder {
      font-weight: bold;
      font-size: 9.5px;
      line-height: 1.25;
      background-color: #ffffff;
    }
    table {
      border-collapse: collapse;
      margin: 0 auto;
      width: 100%;
    }
    .timetable-grid td {
      height: 31px;
      font-size: 9.5px;
    }
    .break-cell {
      background-color: #ffffff;
    }
    .allocation-table td {
      padding: 3.5px 6px;
      font-size: 10.5px;
    }
    .allocation-table th {
      padding: 5px 6px;
      font-weight: bold;
      font-size: 10.5px;
      background-color: #ffffff;
    }
    .page-footer {
      margin-top: 15px;
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      color: #333333;
    }
  </style>
</head>
<body>

  <!-- Header Section with Logo and College Info -->
  <table style="width: 100%; margin-bottom: 6px;" cellspacing="0" cellpadding="2">
    <tbody>
      <tr>
        ${logoTd}
        <td style="vertical-align: middle; text-align: center;">
          <table width="100%" cellspacing="0" cellpadding="1">
            <tbody>
              <tr><td class="reportMainHeading" align="center">${escapeHtml(collegeName)}  ${collegeCode ? `( Code: ${escapeHtml(collegeCode)}  )` : ""}</td></tr>
              ${affiliation ? `<tr><td class="reportHeading1" align="center">${escapeHtml(affiliation)}</td></tr>` : ""}
              ${address ? `<tr><td class="reportHeading1" align="center">${escapeHtml(address)}</td></tr>` : ""}
              ${phone ? `<tr><td class="reportHeading1" align="center">${escapeHtml(phone)}</td></tr>` : ""}
              <tr><td style="height: 6px;"></td></tr>
              <tr><td class="reportHeading1" align="center" style="font-size: 13px; letter-spacing: 1px;">TIME TABLE</td></tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Main Timetable Grid -->
  <table class="timetable-grid" width="100%" cellpadding="2" cellspacing="0">
    <thead>
      ${headerHtml}
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <!-- Allocation of Subjects Title -->
  <div align="center" class="reportMainHeading" style="margin: 14px 0 6px 0; font-size: 13px;">Allocation of Subjects</div>

  <!-- Allocation of Subjects Table -->
  <table class="allocation-table" width="100%" cellspacing="0" cellpadding="2">
    <thead>
      <tr style="background-color: #ffffff;">
        <th align="left" style="width:14%" class="cellBorder">Subject Code</th>
        <th align="left" style="width:36%" class="cellBorder">Subject</th>
        <th align="left" style="width:36%" class="cellBorder">Name of Faculty</th>
        <th align="left" style="width:14%" class="cellBorder">Faculty Initials</th>
      </tr>
    </thead>
    <tbody>
      ${allocationTableHtml}
    </tbody>
  </table>

  <!-- Institutional Page Footer -->
  <div class="page-footer">
    <span>TIME TABLE REPORT</span>
    <span>1/1</span>
  </div>

</body>
</html>`;
}

/** Client-side XLS download function identical to download (2).xls */
export function downloadTimetableAsXls(html: string, filename: string) {
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
