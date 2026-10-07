import type { Department, DayOfWeek, PeriodTiming, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveLogoUrl } from "./logoAsset";
import { HIGHLIGHT_COLORS, highlightFor, type HighlightColorKey, type SubjectHighlights } from "./highlightColors";

// Shared by hod/teaching and panel/teaching's own "Download" button - both
// pages lay a faculty member's own slots out identically (Day columns x
// Period rows) and, until this was extracted, kept two independently-edited
// copies of the exact same PDF-building code.

// A custom subject's generated code ("CUS-AB12C") reads as its typed name instead.
const readable = (code: string | undefined, name: string | undefined) =>
  code && /^CUS-[A-Z0-9]{5}$/.test(code) ? (name || code) : code;

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
  departmentName?: string;
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
  /** College letterhead (name, logo ...) - printed like the section timetable's. */
  college?: { name?: string; code?: string; affiliation?: string; address?: string; phone?: string; logoUrl?: string };
  /** Optional subject code/name/id -> colour, painted on that subject's cells in the PDF grid */
  highlightColors?: SubjectHighlights;
}

export function buildFacultyTimetablePdfHtml(opts: FacultyTimetablePdfOptions): string {
  const { facultyName, departmentName, semesterLabel, weekStart, weekEnd, days, periods, slots, assignmentById, periodTimeFor, courseCodeById, departments, formatDMY, highlightColors = {} } = opts;

  const hasCustomHighlights = Object.keys(highlightColors).length > 0;
  // With none picked, labs keep the default purple.
  const lab = HIGHLIGHT_COLORS.purple;

  // Header cells for days
  const dayHeaderCells = days.map((d) =>
    `<th style="border:1px solid #334155;padding:6px 4px;font-size:8.5pt;font-weight:700;text-transform:uppercase;background:#1e293b;color:#ffffff;text-align:center;">${escapeHtml(DAY_LABELS[d])}</th>`
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
          return `<div style="font-size:7pt;color:#475569;font-weight:600;margin-top:2px;">${escapeHtml(formatTime12h(start))}${EN_DASH}${escapeHtml(formatTime12h(end))}</div>`;
        })()
      : "";

    const cells = days.map((d) => {
      const cellSlots = slots.filter((s) => s.day === d && s.periodNumber === period);
      if (cellSlots.length === 0) {
        return `<td style="border:1px solid #cbd5e1;padding:4px;vertical-align:middle;text-align:center;background:#fafafa;"><span style="color:#94a3b8;font-weight:700;font-size:10pt;">${EN_DASH}</span></td>`;
      }

      // Check if any slot in cell is highlighted
      let cellColor: (typeof HIGHLIGHT_COLORS)[HighlightColorKey] | null = null;
      for (const slot of cellSlots) {
        const assignment = assignmentById.get(slot.assignmentId);
        const codeKey = (assignment?.shortCode || assignment?.subjectCode || (slot as any).subjectCode || slot.subjectId || "").toUpperCase().trim();
        const nameKey = (assignment?.subjectName || slot.subjectName || "").toUpperCase().trim();
        const idKey = (assignment?.subjectId || slot.subjectId || "").toUpperCase().trim();
        cellColor = hasCustomHighlights
          ? highlightFor(highlightColors, codeKey, nameKey, idKey)
          : (assignment?.subjectType === "PRACTICAL" || Boolean(slot.labBatch)) ? lab : null;
        if (cellColor) break;
      }

      const cellBgStyle = cellColor
        ? `background:${cellColor.bg};border:1px solid ${cellColor.border};`
        : "background:#ffffff;border:1px solid #cbd5e1;";

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
          ? `<div style="font-size:7.5pt;font-weight:700;color:${cellColor ? cellColor.text : "#1e293b"};line-height:1.15;text-transform:uppercase;">${escapeHtml(subline)}</div>`
          : "";
        const subjectLine = `<div style="font-size:8.5pt;font-weight:800;color:${cellColor ? cellColor.text : "#0f172a"};margin-top:1px;line-height:1.15;">${escapeHtml(readable(assignment?.shortCode, assignment?.subjectName) || readable(assignment?.subjectCode, assignment?.subjectName) || slot.subjectName)}</div>`;
        const roomLine = slot.classroom
          ? `<div style="font-size:7pt;font-weight:600;color:${cellColor ? cellColor.text : "#475569"};margin-top:2px;">Room: ${escapeHtml(slot.classroom)}</div>`
          : "";
        const divider = i > 0 ? `border-top:1px dashed ${cellColor ? cellColor.border : "#cbd5e1"};margin-top:4px;padding-top:4px;` : "";
        return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;${divider}">${classLine}${subjectLine}${roomLine}</div>`;
      }).join("");

      return `<td style="${cellBgStyle}padding:4px 3px;vertical-align:middle;text-align:center;height:12mm;line-height:1.15;">${blocks}</td>`;
    }).join("");

    return `<tr><td style="border:1px solid #cbd5e1;padding:4px;font-size:8.5pt;font-weight:700;text-align:center;vertical-align:middle;width:9%;background:#f8fafc;color:#1e293b;">Period ${period}${rowTimeLabel}</td>${cells}</tr>`;
  }).join("");

  // Build unique subject workload summary list
  const uniqueAssignments = Array.from(assignmentById.values());
  const workloadRows = uniqueAssignments.map((a, i) => {
    const courseCode = a.courseId ? courseCodeById.get(a.courseId) : undefined;
    const classStr = [courseCode ?? a.courseName, a.year ? romanYear(a.year) : null, a.sectionName].filter(Boolean).join(" ");
    const subCode = (a.shortCode || a.subjectCode || "").toUpperCase().trim();
    const rowColor = hasCustomHighlights
      ? highlightFor(highlightColors, subCode, a.subjectName || "", a.subjectId || "")
      : a.subjectType === "PRACTICAL" ? lab : null;

    const bg = rowColor ? `background:${rowColor.bg};` : (i % 2 === 0 ? "background:#ffffff;" : "background:#f8fafc;");
    return `<tr style="${bg}">
      <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;font-weight:600;">${i + 1}</td>
      <td style="border:1px solid #cbd5e1;padding:4px 8px;"><strong>${escapeHtml(classStr)}</strong></td>
      <td style="border:1px solid #cbd5e1;padding:4px 8px;font-family:monospace;font-size:8pt;"><strong>${escapeHtml(readable(a.subjectCode, a.subjectName) ?? "—")}</strong></td>
      <td style="border:1px solid #cbd5e1;padding:4px 8px;"><strong>${escapeHtml(a.subjectName ?? "—")}</strong></td>
      <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;"><strong>${escapeHtml(readable(a.shortCode, a.subjectName) ?? readable(a.subjectCode, a.subjectName) ?? "—")}</strong></td>
      <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;">${escapeHtml(a.subjectType ?? "THEORY")}</td>
      <td style="border:1px solid #cbd5e1;padding:4px 6px;text-align:center;"><strong>${a.hoursPerWeek ?? "—"}</strong></td>
    </tr>`;
  }).join("");

  const totalHours = uniqueAssignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);
  const resolvedDept = departmentName || Array.from(new Set(uniqueAssignments.map(a => a.department).filter(Boolean))).join(", ");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Faculty Teaching Load & Timetable - ${escapeHtml(facultyName)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #fff; font-size: 10px; line-height: 1.3; }
    .container { width: 100%; max-width: 277mm; margin: 0 auto; }
    .letterhead { width: 100%; border-bottom: 2px solid #0284c7; padding-bottom: 8px; margin-bottom: 10px; }
    .logo-cell { width: 24mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 22mm; max-height: 22mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; padding: 0 10px; }
    .college-name { font-size: 14pt; font-weight: 800; color: #0369a1; text-transform: uppercase; letter-spacing: 0.3px; }
    .identity-line { font-size: 8.5pt; font-weight: 600; color: #334155; margin-top: 1px; }
    .doc-banner { background: #0284c7; color: #ffffff; text-align: center; font-size: 11pt; font-weight: 800; letter-spacing: 1px; padding: 5px; border-radius: 4px; text-transform: uppercase; margin-bottom: 8px; }
    
    .info-bar { display: table; width: 100%; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 4px; padding: 6px 10px; margin-bottom: 10px; font-size: 8.5pt; }
    .info-col { display: table-cell; vertical-align: middle; width: 25%; }
    .info-label { font-size: 7pt; font-weight: 700; color: #0369a1; text-transform: uppercase; }
    .info-val { font-size: 9pt; font-weight: 700; color: #0f172a; }

    .grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 12px; }
    .section-header { font-size: 10.5pt; font-weight: 800; color: #0369a1; border-bottom: 1.5px solid #0284c7; padding-bottom: 3px; margin: 12px 0 6px; text-transform: uppercase; }
    .workload-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
    .workload-table th { font-weight: 800; text-align: left; border: 1px solid #334155; padding: 5px 6px; font-size: 8pt; background: #1e293b; color: #ffffff; }
    .workload-table td { font-size: 8pt; color: #0f172a; }
    .total-row { background: #0284c7 !important; color: #ffffff !important; font-weight: 800; }
    .total-row td { border-color: #0284c7 !important; color: #ffffff !important; font-size: 8.5pt !important; padding: 5px 6px !important; }
  </style>
</head>
<body>
  <div class="container">
    <table class="letterhead" cellspacing="0" cellpadding="0">
      <tr>
        <td class="logo-cell"><img src="${escapeHtml(resolveLogoUrl(opts.college?.logoUrl))}" alt="logo"></td>
        <td class="letterhead-text">
          <div class="college-name">${escapeHtml(opts.college?.name || "VISHNU INSTITUTE OF TECHNOLOGY")}${opts.college?.code ? ` (${escapeHtml(opts.college.code)})` : ""}</div>
          ${[opts.college?.affiliation || "(Approved by AICTE, Affiliated to JNTUK, Kakinada)", opts.college?.address || "Vishnupur, Bhimavaram-534202", opts.college?.phone ? `Tel: ${opts.college.phone}` : ""].filter(Boolean).map((l) => `<div class="identity-line">${escapeHtml(l)}</div>`).join("")}
        </td>
        <td class="logo-cell"></td>
      </tr>
    </table>

    <div class="doc-banner">FACULTY TEACHING LOAD &amp; TIMETABLE</div>

    <div class="info-bar">
      <div class="info-col">
        <div class="info-label">Faculty Name</div>
        <div class="info-val">${escapeHtml(facultyName)}</div>
      </div>
      <div class="info-col">
        <div class="info-label">Department</div>
        <div class="info-val">${escapeHtml(resolvedDept || "—")}</div>
      </div>
      <div class="info-col">
        <div class="info-label">Semester</div>
        <div class="info-val">${escapeHtml(semesterLabel)}</div>
      </div>
      <div class="info-col">
        <div class="info-label">Academic Period</div>
        <div class="info-val">${escapeHtml(formatDMY(weekStart))} &ndash; ${escapeHtml(formatDMY(weekEnd))}</div>
      </div>
    </div>

    <table class="grid-table">
      <thead>
        <tr>
          <th style="border:1px solid #334155;padding:6px 2px;font-size:8.5pt;font-weight:700;width:9%;background:#1e293b;color:#ffffff;text-align:center;">Period / Day</th>
          ${dayHeaderCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    ${uniqueAssignments.length > 0 ? `
    <div>
      <div class="section-header">Teaching Workload &amp; Subject Summary</div>
      <table class="workload-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">S.No</th>
            <th style="width: 18%;">Course &amp; Section</th>
            <th style="width: 14%;">Subject Code</th>
            <th style="width: 33%;">Subject Name</th>
            <th style="width: 10%; text-align: center;">Short Code</th>
            <th style="width: 10%; text-align: center;">Type</th>
            <th style="width: 10%; text-align: center;">Hours / Wk</th>
          </tr>
        </thead>
        <tbody>
          ${workloadRows}
          <tr class="total-row">
            <td colspan="6" style="text-align: right; padding-right: 12px; font-size: 8.5pt;">TOTAL TEACHING WORKLOAD:</td>
            <td style="text-align: center; font-size: 9pt;">${totalHours} Hours / Wk</td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ""}
  </div>
</body>
</html>`;
}
