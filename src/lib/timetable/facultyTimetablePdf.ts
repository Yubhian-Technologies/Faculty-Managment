import type { Department, DayOfWeek, PeriodTiming, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveLogoUrl } from "./logoAsset";

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
    `<th style="border:1px solid #555;padding:3px 4px;font-size:8.5pt;font-weight:700;text-transform:uppercase;">${escapeHtml(DAY_LABELS[d])}</th>`
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
        return `<td style="border:1px solid #555;padding:2px;vertical-align:middle;text-align:center;"><span style="color:#888;font-weight:700;font-size:10pt;">${EN_DASH}</span></td>`;
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
          ? `<div style="font-size:8pt;font-weight:700;color:#000;line-height:1.15;text-transform:uppercase;">${escapeHtml(subline)}</div>`
          : "";
        const subjectLine = `<div style="font-size:8pt;font-weight:700;color:#000;margin-top:1px;line-height:1.15;">${escapeHtml(readable(assignment?.shortCode, assignment?.subjectName) || readable(assignment?.subjectCode, assignment?.subjectName) || slot.subjectName)}</div>`;
        const roomLine = slot.classroom
          ? `<div style="font-size:7pt;font-weight:400;color:#333;margin-top:1px;">Room: ${escapeHtml(slot.classroom)}</div>`
          : "";
        const divider = i > 0 ? "border-top:1px dashed #888;margin-top:3px;padding-top:3px;" : "";
        return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;${divider}">${classLine}${subjectLine}${roomLine}</div>`;
      }).join("");

      return `<td style="border:1px solid #555;padding:2px 3px;vertical-align:middle;text-align:center;height:11mm;line-height:1.15;">${blocks}</td>`;
    }).join("");

    return `<tr><td style="border:1px solid #555;padding:2px;font-size:8.5pt;font-weight:700;text-align:center;vertical-align:middle;width:10%;">Period ${period}${rowTimeLabel}</td>${cells}</tr>`;
  }).join("");

  // Build unique subject workload summary list
  const uniqueAssignments = Array.from(assignmentById.values());
  const workloadRows = uniqueAssignments.map((a, i) => {
    const courseCode = a.courseId ? courseCodeById.get(a.courseId) : undefined;
    const classStr = [courseCode ?? a.courseName, a.year ? romanYear(a.year) : null, a.sectionName].filter(Boolean).join(" ");
    return `<tr>
      <td style="border:1px solid #555;padding:2px 3px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #555;padding:2px 6px;"><strong>${escapeHtml(classStr)}</strong></td>
      <td style="border:1px solid #555;padding:2px 6px;"><strong>${escapeHtml(readable(a.subjectCode, a.subjectName) ?? "—")}</strong></td>
      <td style="border:1px solid #555;padding:2px 6px;"><strong>${escapeHtml(a.subjectName ?? "—")}</strong></td>
      <td style="border:1px solid #555;padding:2px 3px;text-align:center;"><strong>${escapeHtml(readable(a.shortCode, a.subjectName) ?? readable(a.subjectCode, a.subjectName) ?? "—")}</strong></td>
      <td style="border:1px solid #555;padding:2px 3px;text-align:center;">${escapeHtml(a.subjectType ?? "Theory")}</td>
      <td style="border:1px solid #555;padding:2px 3px;text-align:center;"><strong>${a.hoursPerWeek ?? "—"}</strong></td>
    </tr>`;
  }).join("");

  const totalHours = uniqueAssignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Faculty Timetable - ${escapeHtml(facultyName)}</title>
  <style>
    /* Same page, letterhead and table look as the section timetable PDF
       (lib/timetable/sectionTimetablePdf.ts): plain white cells, thin grey grid. */
    @page { size: A4 landscape; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    .container { width: 100%; max-width: 273mm; margin: 0 auto; }
    .letterhead { width: 100%; border: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .college-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 10pt; font-weight: 700; overflow-wrap: anywhere; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 4px; }
    .class-line { text-align: center; font-size: 9pt; font-weight: 600; margin-bottom: 8px; overflow-wrap: anywhere; }
    .grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 8px 0 10px; }
    .grid-table th, .grid-table td { border: 1px solid #555; }
    .section-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 18px 0 8px; }
    .workload-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .workload-table th { font-weight: 700; text-align: left; border: 1px solid #555; padding: 2px 6px; font-size: 7.5pt; background: #fff; }
    .workload-table td { border: 1px solid #555; padding: 2px 6px; font-size: 7.5pt; }
  </style>
</head>
<body>
  <div class="container">
    <table class="letterhead" cellspacing="0" cellpadding="0">
      <tr>
        <td class="logo-cell"><img src="${escapeHtml(resolveLogoUrl(opts.college?.logoUrl))}" alt="logo"></td>
        <td class="letterhead-text">
          ${opts.college?.name ? `<div class="college-name">${escapeHtml(opts.college.name)}${opts.college.code ? ` ( Code: ${escapeHtml(opts.college.code)} )` : ""}</div>` : ""}
          ${[opts.college?.affiliation, opts.college?.address, opts.college?.phone ? `Tel : ${opts.college.phone}` : ""].filter(Boolean).map((l) => `<div class="identity-line">${escapeHtml(l as string)}</div>`).join("")}
        </td>
        <td class="logo-cell"></td>
      </tr>
    </table>
    <div class="doc-title">FACULTY TIME TABLE</div>
    <div class="class-line">${escapeHtml(facultyName)}  |  Semester: ${escapeHtml(semesterLabel)}  |  ${escapeHtml(formatDMY(weekStart))} &ndash; ${escapeHtml(formatDMY(weekEnd))}</div>

    <table class="grid-table">
      <thead>
        <tr>
          <th style="border:1px solid #555;padding:3px 2px;font-size:8.5pt;font-weight:700;width:10%;">Period / Day</th>
          ${dayHeaderCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    ${uniqueAssignments.length > 0 ? `
    <div class="workload-box">
      <div class="section-title">Teaching Workload &amp; Subject Details</div>
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
          <tr style="font-weight: 700;">
            <td colspan="6" style="text-align: right; padding-right: 12px; font-size: 8pt;">TOTAL TEACHING WORKLOAD:</td>
            <td style="text-align: center; font-size: 8.5pt;"><strong>${totalHours} Hours</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ""}
  </div>
</body>
</html>`;
}
