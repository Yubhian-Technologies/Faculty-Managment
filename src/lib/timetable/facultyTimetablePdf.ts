import type { Department, DayOfWeek, PeriodTiming, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";

// Shared by hod/teaching and panel/teaching's own "Download" button - both
// pages lay a faculty member's own slots out identically (Day columns x
// Period rows) and, until this was extracted, kept two independently-edited
// copies of the exact same PDF-building code.

/** "09:00" -> "9:00 AM" - display only. */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** A subject/section/classroom name containing "&", "<" etc. would otherwise render as broken markup in the PDF. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ROMAN_YEARS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
/** 2 -> "II" - falls back to the plain number past the table (a course longer than 8 years). */
export function romanYear(year: number): string {
  return ROMAN_YEARS[year - 1] ?? String(year);
}

const EN_DASH = "–";

export interface FacultyTimetablePdfOptions {
  facultyName: string;
  /** e.g. "3", "2, 4" (spans more than one course-year's semester), or "—" (none configured). */
  semesterLabel: string;
  weekStart: Date;
  weekEnd: Date;
  days: DayOfWeek[];
  periods: number[];
  /** Already filtered to the "standing" set the download represents - see each page's own downloadPdf() comment for why (drops synthetic substitute_* entries and same-week-only substitution annotations). */
  slots: (TimetableSlot & { id: string })[];
  assignmentById: Map<string, TeachingAssignment>;
  periodTimeFor: (courseId: string | undefined, year: number | undefined, period: number) => PeriodTiming | undefined;
  /** courseId -> Course.code (Course Catalog's short code) - falls back to the full courseName when a course isn't found (e.g. a legacy assignment). */
  courseCodeById: Map<string, string>;
  departments: Department[];
  formatDMY: (d: Date) => string;
}

/**
 * ponytail: a period row shows ONE clock time only when every occupied cell
 * in that row resolves to the identical start/end (the overwhelming common
 * case - see periodTimeFor). A row spanning course-years whose periods
 * genuinely run different clock times for the same period number shows just
 * "Period N" with no time, rather than one cell's time mislabeling another's.
 * Upgrade path: show each distinct time next to whichever cells it actually
 * covers, if that case turns out to matter in practice.
 */
export function buildFacultyTimetablePdfHtml(opts: FacultyTimetablePdfOptions): string {
  const { facultyName, semesterLabel, weekStart, weekEnd, days, periods, slots, assignmentById, periodTimeFor, courseCodeById, departments, formatDMY } = opts;

  // Header cells for days
  const dayHeaderCells = days.map((d) =>
    `<th style="border:1px solid #000;background:#f0f0f0;color:#000;padding:6px 4px;font-size:9.5pt;font-weight:800;text-transform:uppercase;">${escapeHtml(DAY_LABELS[d])}</th>`
  ).join("");

  const bodyRows = periods.map((period) => {
    const rowSlots = slots.filter((s) => s.periodNumber === period && days.includes(s.day));
    const rowTimes = new Set(
      rowSlots
        .map((s) => periodTimeFor(s.courseId, s.year, period))
        .filter((t): t is PeriodTiming => !!t)
        .map((t) => `${t.startTime}-${t.endTime}`)
    );
    const rowTimeLabel = rowTimes.size === 1
      ? (() => {
          const [start, end] = [...rowTimes][0].split("-");
          return `<div style="font-size:7.5pt;color:#333;font-weight:600;margin-top:2px;">${escapeHtml(formatTime12h(start))}${EN_DASH}${escapeHtml(formatTime12h(end))}</div>`;
        })()
      : "";

    const cells = days.map((d) => {
      // Every slot in the cell: one faculty can hold two sections in the same period.
      const cellSlots = slots.filter((s) => s.day === d && s.periodNumber === period);
      if (cellSlots.length === 0) {
        return `<td style="border:1px solid #000;padding:2px;vertical-align:middle;text-align:center;"><span style="color:#888;font-weight:700;font-size:10pt;">${EN_DASH}</span></td>`;
      }
      const blocks = cellSlots.map((slot, i) => {
        const assignment = assignmentById.get(slot.assignmentId);
        const courseCode = assignment?.courseId ? courseCodeById.get(assignment.courseId) : undefined;
        const sectionLabel = assignment?.sectionName
          ? sectionDisplayLabel({ department: assignment.department, name: assignment.sectionName, secondaryDepartments: [] }, departments)
          : null;
        const subline = [
          courseCode ?? assignment?.courseName,
          assignment?.year ? romanYear(assignment.year) : null,
          sectionLabel,
        ].filter(Boolean).join(" · ");

        const classLine = subline
          ? `<div style="font-size:9pt;font-weight:900;color:#000;line-height:1.2;text-transform:uppercase;">${escapeHtml(subline)}</div>`
          : "";
        const subjectLine = `<div style="font-size:8.5pt;font-weight:800;color:#000;margin-top:2px;line-height:1.2;">${escapeHtml(assignment?.shortCode || assignment?.subjectCode || slot.subjectName)}</div>`;
        const roomLine = slot.classroom
          ? `<div style="font-size:7.5pt;font-weight:600;color:#222;margin-top:2px;">Room: ${escapeHtml(slot.classroom)}</div>`
          : "";
        const divider = i > 0 ? "border-top:1px dashed #888;margin-top:3px;padding-top:3px;" : "";
        return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;${divider}">${classLine}${subjectLine}${roomLine}</div>`;
      }).join("");

      return `<td style="border:1px solid #000;padding:4px 3px;vertical-align:middle;text-align:center;height:18mm;">${blocks}</td>`;
    }).join("");

    return `<tr><td style="border:1px solid #000;padding:5px 2px;font-size:9pt;font-weight:800;text-align:center;background:#f0f0f0;vertical-align:middle;width:10%;">Period ${period}${rowTimeLabel}</td>${cells}</tr>`;
  }).join("");

  // Build unique subject workload summary list
  const uniqueAssignments = Array.from(assignmentById.values());
  const workloadRows = uniqueAssignments.map((a, i) => {
    const courseCode = a.courseId ? courseCodeById.get(a.courseId) : undefined;
    const classStr = [courseCode ?? a.courseName, a.year ? romanYear(a.year) : null, a.sectionName].filter(Boolean).join(" ");
    return `<tr>
      <td style="border:1px solid #000;padding:3px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #000;padding:3px 6px;"><strong>${escapeHtml(classStr)}</strong></td>
      <td style="border:1px solid #000;padding:3px 6px;"><strong>${escapeHtml(a.subjectCode ?? "—")}</strong></td>
      <td style="border:1px solid #000;padding:3px 6px;"><strong>${escapeHtml(a.subjectName ?? "—")}</strong></td>
      <td style="border:1px solid #000;padding:3px;text-align:center;"><strong>${escapeHtml(a.shortCode ?? a.subjectCode ?? "—")}</strong></td>
      <td style="border:1px solid #000;padding:3px;text-align:center;">${escapeHtml(a.subjectType ?? "Theory")}</td>
      <td style="border:1px solid #000;padding:3px;text-align:center;"><strong>${a.hoursPerWeek ?? "—"}</strong></td>
    </tr>`;
  }).join("");

  const totalHours = uniqueAssignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Faculty Timetable - ${escapeHtml(facultyName)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    .container { width: 100%; max-width: 273mm; margin: 0 auto; }
    .header-box { border: 2px solid #000; padding: 8px 12px; text-align: center; margin-bottom: 8px; }
    .inst-name { font-size: 15pt; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 2px; }
    .dept-name { font-size: 11pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; margin: 4px 0; }
    .academic-info { font-size: 9.5pt; font-weight: 700; display: flex; justify-content: space-between; padding-top: 2px; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; border: 1.5px solid #000; }
    .meta-table td { border: 1px solid #000; padding: 4px 8px; font-size: 8.5pt; }
    .grid-table { width: 100%; border-collapse: collapse; border: 2px solid #000; table-layout: fixed; margin-bottom: 10px; }
    .workload-box { border: 1.5px solid #000; margin-bottom: 16px; }
    .workload-title { background: #000; color: #fff; font-weight: 800; font-size: 8pt; padding: 3px 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .workload-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .workload-table th { background: #f0f0f0; font-weight: 800; text-align: left; border: 1px solid #000; padding: 3px 6px; font-size: 7.5pt; }
    .workload-table td { border: 1px solid #000; padding: 3px 6px; font-size: 7.5pt; }
    .sig-section { display: flex; justify-content: space-between; margin-top: 24px; padding: 0 20px; }
    .sig-block { text-align: center; width: 28%; }
    .sig-line { border-top: 1.5px solid #000; margin-bottom: 4px; }
    .sig-title { font-size: 8.5pt; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-box">
      <div class="inst-name">Faculty Timetable</div>
      <div class="dept-name">Department Teaching Schedule</div>
      <div class="academic-info">
        <span>FACULTY: <strong>${escapeHtml(facultyName)}</strong></span>
        <span>SEMESTER: <strong>${escapeHtml(semesterLabel)}</strong></span>
        <span>PERIOD: <strong>${escapeHtml(formatDMY(weekStart))} &ndash; ${escapeHtml(formatDMY(weekEnd))}</strong></span>
      </div>
    </div>

    <table class="grid-table">
      <thead>
        <tr>
          <th style="border:1px solid #000;background:#f0f0f0;color:#000;padding:6px 2px;font-size:9pt;font-weight:800;width:10%;">Period / Day</th>
          ${dayHeaderCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    ${uniqueAssignments.length > 0 ? `
    <div class="workload-box">
      <div class="workload-title">Teaching Workload & Subject Details</div>
      <table class="workload-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">S.No</th>
            <th style="width: 15%;">Course & Section</th>
            <th style="width: 12%;">Sub Code</th>
            <th style="width: 38%;">Subject Name</th>
            <th style="width: 10%; text-align: center;">Short Code</th>
            <th style="width: 10%; text-align: center;">Type</th>
            <th style="width: 10%; text-align: center;">Hours / Wk</th>
          </tr>
        </thead>
        <tbody>
          ${workloadRows}
          <tr style="background: #f0f0f0; font-weight: 800;">
            <td colspan="6" style="border:1px solid #000;text-align: right; padding-right: 12px; font-size: 8pt;">TOTAL TEACHING WORKLOAD:</td>
            <td style="border:1px solid #000;text-align: center; font-size: 8.5pt;"><strong>${totalHours} Hours</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ""}

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Faculty Member</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Time Table Incharge</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Head of Department (HOD)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
