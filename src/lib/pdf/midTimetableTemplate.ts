import { logoSrc } from "@/lib/pdf/logo";
import { timeLabel } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

// Print-ready HTML (A4 landscape) for one Mid's exam timetable, laid out like
// the college's own sheet: letterhead, "MID-I EXAMINATIONS - TIME TABLE", the
// course / year / semester and the exam time, then branches down the side and
// the exam days across the top; electives share a cell under their heading.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

const STYLE = `
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
  .grp { font-weight: bold; text-decoration: underline; display: block; margin-bottom: 2px; }
  .subj { display: block; }
  .code { white-space: nowrap; }
  tr { break-inside: avoid-page; }
  .sign { display: flex; justify-content: space-between; margin-top: 28px; font-weight: bold; font-size: 12px; }
`;

export interface MidTimetableSheetPrint {
  courseName: string; year: number; semester: number; midNumber: number;
  days: string[]; sessions: MidExamSession[];
  rows: { branch: string; slots: MidExamSlot[] }[];
}

export function getMidTimetableHTML(d: { college: { name: string; affiliation?: string; address?: string; logoUrl?: string }; sheet: MidTimetableSheetPrint }): string {
  const t = d.sheet;
  const cols = t.days.flatMap((day) => t.sessions.map((s) => ({ day, s })));
  const cell = (slots: MidExamSlot[]) => {
    if (!slots.length) return "-";
    const group = slots.find((x) => x.group)?.group;
    return `${group ? `<span class="grp">${esc(group)}</span>` : ""}${slots.map((x, i) => `<span class="subj">${esc(x.subjectName)} <span class="code">(${esc(x.subjectCode)})</span>${i < slots.length - 1 ? " /" : ""}</span>`).join("")}`;
  };
  const head1 = `<tr><th class="branch" rowspan="${t.sessions.length > 1 ? 2 : 1}">Branch</th>${t.days.map((day) => `<th colspan="${t.sessions.length}">${dmy(day)}<span class="wd">(${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]})</span></th>`).join("")}</tr>`;
  const head2 = t.sessions.length > 1 ? `<tr>${cols.map(({ s }) => `<th>${esc(s.label)}<span class="wd">${timeLabel(s.from)} - ${timeLabel(s.to)}</span></th>`).join("")}</tr>` : "";
  const body = t.rows.map((r) => `<tr><td class="branch">${esc(r.branch)}</td>${cols.map(({ day, s }) => `<td>${cell(r.slots.filter((x) => x.date === day && x.sessionId === s.id))}</td>`).join("")}</tr>`).join("");
  const time = t.sessions.length === 1 ? `TIME: ${timeLabel(t.sessions[0].from)} - ${timeLabel(t.sessions[0].to)}` : "";
  const months = [...new Set(t.days.map((x) => new Date(`${x}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase()))].join(" / ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div class="center"><p class="college">${esc(d.college.name)}</p>${d.college.affiliation ? `<p class="sub">(${esc(d.college.affiliation)})</p>` : ""}</div>
    </div>
    <p class="center branch-office">EXAMINATION BRANCH</p>
    <p class="center exam">${esc(t.courseName)} - ${ROMAN[t.year] ?? t.year} YEAR - SEMESTER ${t.semester} &nbsp; MID-${ROMAN[t.midNumber] ?? t.midNumber} EXAMINATIONS${months ? ` - ${esc(months)}` : ""}</p>
    <div class="row2"><span></span><span class="tt">TIME TABLE</span><span class="time">${esc(time)}</span></div>
    <table><thead>${head1}${head2}</thead><tbody>${body}</tbody></table>
    <div class="sign"><span>Controller of Examinations</span><span>Principal</span></div>
  </div></body></html>`;
}
