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
  rows: { branch: string; slots: MidExamSlot[]; usualSessionId?: string }[];
}

export function getMidTimetableHTML(d: { college: { name: string; affiliation?: string; address?: string; logoUrl?: string }; sheet: MidTimetableSheetPrint }): string {
  const t = d.sheet;
  const ses = (id?: string) => t.sessions.find((x) => x.id === id);
  const span = (x?: MidExamSession) => (x ? `${timeLabel(x.from)} - ${timeLabel(x.to)}` : "");
  const subjects = (slots: MidExamSlot[]) => {
    const group = slots.find((x) => x.group)?.group;
    const moved = slots.find((x) => x.movedFrom)?.movedFrom;
    return `${moved ? `<span class="moved">Rescheduled (was ${dmy(moved)})</span>` : ""}${group ? `<span class="grp">${esc(group)}</span>` : ""}${slots.map((x, i) => `<span class="subj">${esc(x.subjectName)}<span class="code">(${esc(x.subjectCode)})${i < slots.length - 1 ? " /" : ""}</span></span>`).join("")}`;
  };
  // One cell per day: each session's subjects, with its time when it isn't the branch's usual one (or two that day).
  const cell = (slots: MidExamSlot[], usual?: string) => {
    if (!slots.length) return "-";
    const ids = [...new Set(slots.map((x) => x.sessionId))].sort((a, b) => (ses(a)?.from ?? "").localeCompare(ses(b)?.from ?? ""));
    const showTime = ids.length > 1 || ids.some((id) => id !== usual);
    return ids.map((id, i) => `${i ? '<hr class="sep" />' : ""}${showTime ? `<span class="tm">${span(ses(id))}</span>` : ""}${subjects(slots.filter((x) => x.sessionId === id))}`).join("");
  };
  // One time for everyone -> the TIME line; else a Time column per branch.
  const usuals = [...new Set(t.rows.map((r) => r.usualSessionId))];
  const oneTime = usuals.length === 1 && t.rows.every((r) => r.slots.every((x) => x.sessionId === usuals[0]));
  const head = `<tr><th class="branch">Branch</th>${oneTime ? "" : `<th class="tcol">Time</th>`}${t.days.map((day) => `<th>${dmy(day)}<span class="wd">(${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]})</span></th>`).join("")}</tr>`;
  const body = t.rows.map((r) => `<tr><td class="branch">${esc(r.branch)}</td>${oneTime ? "" : `<td class="tcol">${span(ses(r.usualSessionId))}</td>`}${t.days.map((day) => `<td>${cell(r.slots.filter((x) => x.date === day), r.usualSessionId)}</td>`).join("")}</tr>`).join("");
  const time = oneTime && ses(usuals[0]) ? `TIME: ${span(ses(usuals[0]))}` : "";
  const months = [...new Set(t.days.map((x) => new Date(`${x}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase()))].join(" / ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div class="center"><p class="college">${esc(d.college.name)}</p>${d.college.affiliation ? `<p class="sub">(${esc(d.college.affiliation)})</p>` : ""}</div>
    </div>
    <p class="center branch-office">EXAMINATION BRANCH</p>
    <p class="center exam">${esc(t.courseName)} - ${ROMAN[t.year] ?? t.year} YEAR - SEMESTER ${t.semester} &nbsp; MID-${ROMAN[t.midNumber] ?? t.midNumber} EXAMINATIONS${months ? ` - ${esc(months)}` : ""}</p>
    <div class="row2"><span></span><span class="tt">TIME TABLE</span><span class="time">${esc(time)}</span></div>
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="sign"><span>Controller of Examinations</span><span>Principal</span></div>
  </div></body></html>`;
}
