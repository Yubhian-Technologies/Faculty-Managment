import { logoSrc } from "@/lib/pdf/logo";
import { dayLabel, sessionText } from "@/lib/midTimetable/rules";
import type { MidExamSession, MidExamSlot } from "@/types";

// Print-ready HTML for Mid exam timetables (turned into a PDF in the browser by
// htmlToPdf): the college letterhead, then per branch a table of exam days x
// sessions with each subject's name and code.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; font-size: 12px; }
  .page { width: 210mm; padding: 14mm 15mm; box-sizing: border-box; }
  .pdf-page-header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px; }
  .pdf-page-header img { height: 48px; }
  .college { font-size: 17px; font-weight: bold; color: #1e3a8a; margin: 0; }
  .sub { font-size: 11px; color: #444; margin: 2px 0 0; }
  .section { break-inside: avoid-page; margin-bottom: 18px; }
  h1 { font-size: 15px; text-align: center; margin: 8px 0 2px; }
  .meta { text-align: center; font-size: 11px; color: #333; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px 7px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
  th { background: #f3f4f6; font-size: 11px; }
  tr { break-inside: avoid-page; }
  .date { width: 120px; font-weight: bold; }
  .code { color: #555; font-size: 10px; }
  .none { color: #999; }
`;

export interface MidTimetablePrint {
  courseName: string; year: number; semester: number; midNumber: number; branch: string;
  slots: MidExamSlot[]; sessions: MidExamSession[];
}

export function getMidTimetableHTML(d: { college: { name: string; affiliation?: string; address?: string; logoUrl?: string }; timetables: MidTimetablePrint[] }): string {
  const sections = d.timetables.map((t) => {
    const days = [...new Set(t.slots.map((s) => s.date))].sort();
    const rows = days.map((day) => `<tr><td class="date">${esc(dayLabel(day))}</td>${t.sessions.map((s) => {
      const slot = t.slots.find((x) => x.date === day && x.sessionId === s.id);
      return `<td>${slot ? `${esc(slot.subjectName)}<div class="code">${esc(slot.subjectCode)}</div>` : `<span class="none">-</span>`}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="section">
      <h1>Mid ${t.midNumber} Examination Timetable</h1>
      <div class="meta">${esc(t.courseName)} · Year ${t.year} · Semester ${t.semester} · ${esc(t.branch)}</div>
      <table><thead><tr><th class="date">Date</th>${t.sessions.map((s) => `<th>${esc(sessionText(s))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div><p class="college">${esc(d.college.name)}</p>${d.college.affiliation ? `<p class="sub">${esc(d.college.affiliation)}</p>` : ""}${d.college.address ? `<p class="sub">${esc(d.college.address)}</p>` : ""}</div>
    </div>
    ${sections}
  </div></body></html>`;
}
