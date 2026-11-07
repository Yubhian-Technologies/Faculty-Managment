import { EXAM_HEADER_STYLE, examHeaderHTML, examLine, type ExamOf } from "@/lib/pdf/examHeader";
import { timeLabel } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

// Print-ready HTML (A4 landscape) for one Mid's exam timetable, laid out like
// the college's own sheet: letterhead, exam line, "TIME TABLE", then branches
// (short codes) down the side and ONE COLUMN PER EXAM SESSION across the top -
// date, day and that session's time in the header, the subject in the cell -
// so the whole Mid fits one page (no key of the codes); electives share a cell under their heading.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

const STYLE = `${EXAM_HEADER_STYLE}
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; font-size: 12.5px; }
  .page { width: 297mm; padding: 10mm 12mm; box-sizing: border-box; }
  .pdf-page-header { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 4px; }
  .pdf-page-header img { height: 50px; }
  .college { font-size: 18px; font-weight: bold; margin: 0; text-transform: uppercase; }
  .sub { font-size: 11px; margin: 2px 0 0; }
  .center { text-align: center; }
  .branch-office { letter-spacing: 4px; font-weight: bold; font-size: 12px; margin: 4px 0 2px; }
  .exam { font-style: italic; font-weight: bold; font-size: 15px; margin: 2px 0; }
  .row2 { display: flex; justify-content: space-between; align-items: baseline; margin: 4px 0 8px; }
  .tt { letter-spacing: 6px; font-weight: bold; font-size: 13px; }
  .time { font-weight: bold; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #222; padding: 9px 6px; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }
  th { font-size: 13px; }
  th .wd { display: block; font-weight: normal; }
  .branch { width: 120px; font-weight: bold; }
  table.sheet .branch { width: 70px; }
  table.sheet th, table.sheet td { padding: 6px 4px; font-size: 11.5px; }
  th .th-tm { display: block; font-size: 10.5px; margin-top: 2px; }

  .tcol { width: 78px; font-size: 11px; font-weight: bold; }
  .tm { display: block; font-size: 10px; font-weight: bold; margin-bottom: 2px; }
  hr.sep { border: 0; border-top: 1px dashed #777; margin: 5px 0; }
  .moved { display: block; font-size: 0.85em; font-style: italic; font-weight: bold; margin-bottom: 2px; }
  .grp { font-weight: bold; text-decoration: underline; display: block; margin-bottom: 2px; }
  .subj { display: block; margin-bottom: 3px; }
  .subj:last-child { margin-bottom: 0; }
  .code { display: block; font-size: 0.9em; color: #333; overflow-wrap: anywhere; word-break: break-word; }
  tr { break-inside: avoid-page; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; font-weight: bold; font-size: 12px; }
`;

export interface MidTimetableSheetPrint {
  courseName: string; year: number; semester: number; midNumber: number;
  days: string[]; sessions: MidExamSession[];
  rows: { branch: string; slots: MidExamSlot[]; usualSessionId?: string; /** Short code (CSE, ECE ...) shown instead of the name. */ branchCode?: string }[];
  /** Session-wise sheets: the session's name, printed beside TIME TABLE. */
  sessionTitle?: string;
  /** For the exam line ("I B.TECH. I SEMESTER MID-1 EXAMINATION") and the academic year in the header. */
  exam?: ExamOf;
  academicYear?: string;
}

/** One sheet per session: the branches with an exam then, and only those exams (the session's time on top). */
export function splitBySession(sheet: MidTimetableSheetPrint): MidTimetableSheetPrint[] {
  return [...sheet.sessions].sort((a, b) => a.from.localeCompare(b.from)).map((s) => ({
    ...sheet, sessions: [s], sessionTitle: s.label,
    days: sheet.days.filter((d) => sheet.rows.some((r) => r.slots.some((x) => x.date === d && x.sessionId === s.id))),
    rows: sheet.rows.map((r) => ({ ...r, usualSessionId: s.id, slots: r.slots.filter((x) => x.sessionId === s.id) })).filter((r) => r.slots.length),
  })).filter((x) => x.rows.length);
}

export function getMidTimetableHTML(d: { college: { name: string; affiliation?: string; address?: string; logoUrl?: string }; sheet: MidTimetableSheetPrint }): string {
  const t = d.sheet;
  const subjects = (slots: MidExamSlot[]) => {
    const group = slots.find((x) => x.group)?.group;
    const moved = slots.find((x) => x.movedFrom)?.movedFrom;
    return `${moved ? `<span class="moved">Rescheduled (was ${dmy(moved)})</span>` : ""}${group ? `<span class="grp">${esc(group)}</span>` : ""}${slots.map((x, i) => `<span class="subj">${esc(x.subjectName)}<span class="code">(${esc(x.subjectCode)})${i < slots.length - 1 ? " /" : ""}</span></span>`).join("")}`;
  };
  // One column per (day, session) that has an exam - the time goes in the header, so there is no Time column.
  const ordered = [...t.sessions].sort((a, b) => a.from.localeCompare(b.from));
  const cols = t.days.flatMap((day) => ordered.map((x) => ({ day, s: x })))
    .filter((c) => t.rows.some((r) => r.slots.some((x) => x.date === c.day && x.sessionId === c.s.id)));
  const label = (r: MidTimetableSheetPrint["rows"][number]) => r.branchCode?.trim() || r.branch;
  const head = `<tr><th class="branch">Branch</th>${cols.map((c) => `<th>${dmy(c.day)}<span class="wd">(${WEEKDAY[new Date(`${c.day}T00:00:00Z`).getUTCDay()]})</span><span class="th-tm">${timeLabel(c.s.from)} to ${timeLabel(c.s.to)}</span></th>`).join("")}</tr>`;
  const body = t.rows.map((r) => `<tr><td class="branch" title="${esc(r.branch)}">${esc(label(r))}</td>${cols.map((c) => {
    const slots = r.slots.filter((x) => x.date === c.day && x.sessionId === c.s.id);
    return `<td>${slots.length ? subjects(slots) : "-"}</td>`;
  }).join("")}</tr>`).join("");
  const months = [...new Set(t.days.map((x) => new Date(`${x}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase()))].join(" / ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    ${examHeaderHTML({
      college: d.college,
      lines: [t.exam ? examLine(t.exam) : `${t.courseName} - Year ${t.year} - Semester ${t.semester} - Mid-${t.midNumber} Examination`.toUpperCase()],
      academicYear: t.academicYear,
      title: `Time Table${t.sessionTitle ? ` - ${t.sessionTitle} Session` : ""}${months ? ` - ${months}` : ""}`,
    })}
    <table class="sheet"><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="sign"><span>Controller of Examinations</span><span>Principal</span></div>
  </div></body></html>`;
}

/** One branch's own Mid timetable (a page of its own): Date, Day, Time, Subject - electives together. */
export function getBranchTimetableHTML(d: { college: { name: string; affiliation?: string; logoUrl?: string }; sheet: MidTimetableSheetPrint; row: MidTimetableSheetPrint["rows"][number] }): string {
  const t = d.sheet, r = d.row;
  const ses = (id?: string) => t.sessions.find((x) => x.id === id);
  const exams = [...new Set(r.slots.map((x) => `${x.date}|${x.sessionId}`))]
    .map((k) => { const [date, sid] = k.split("|"); return { date, s: ses(sid), slots: r.slots.filter((x) => x.date === date && x.sessionId === sid) }; })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.s?.from ?? "").localeCompare(b.s?.from ?? ""));
  const rows = exams.map(({ date, s, slots }) => {
    const group = slots.find((x) => x.group)?.group;
    const moved = slots.find((x) => x.movedFrom)?.movedFrom;
    const subj = `${moved ? `<span class="moved">Rescheduled (was ${dmy(moved)})</span>` : ""}${group ? `<span class="grp">${esc(group)}</span>` : ""}${slots.map((x) => `${esc(x.subjectName)} <span class="c2">(${esc(x.subjectCode)})</span>`).join(" / ")}`;
    return `<tr><td><b>${dmy(date)}</b></td><td>${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]}</td><td>${s ? `${timeLabel(s.from)} - ${timeLabel(s.to)}` : ""}</td><td class="l">${subj}</td></tr>`;
  }).join("");
  const months = [...new Set(exams.map((x) => new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase()))].join(" / ");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}
    .bt { width: 78%; margin: 0 auto; } .bt td { padding: 8px 10px; } .bt td.l { text-align: left; } .c2 { color: #333; font-size: 0.9em; }
    .brn { text-align: center; font-weight: bold; font-size: 15px; margin: 6px 0 10px; }
  </style></head><body><div class="page">
    ${examHeaderHTML({
      college: d.college,
      lines: [t.exam ? examLine(t.exam) : `${t.courseName} - Year ${t.year} - Semester ${t.semester} - Mid-${t.midNumber} Examination`.toUpperCase()],
      academicYear: t.academicYear,
      title: `${r.branch} - Time Table${months ? ` - ${months}` : ""}`,
    })}
    <table class="bt"><thead><tr><th style="width:16%">Date</th><th style="width:14%">Day</th><th style="width:22%">Time</th><th>Subject</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sign"><span>Controller of Examinations</span><span>Principal</span></div>
  </div></body></html>`;
}
