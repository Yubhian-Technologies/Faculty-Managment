import { logoSrc } from "@/lib/pdf/logo";
import { benchRows } from "@/lib/exams/seatingLayers";
import { rollRangeBySection } from "@/lib/exams/seatingAllocator";
import { SEAT_LETTERS } from "@/lib/exams/seatingPaired";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import type { ExamSeatingPlan, SeatingRoomAllocation } from "@/types/examSeating";

// Print-ready HTML (A4 portrait) for an exam seating plan:
//   roomSheetHTML      - one room: bench-wise Regd. Nos (for the door / the invigilator)
//   noticeBoardHTML    - every room with the Regd. No ranges of each section (the notice board)
//   attendanceSheetHTML - one room: Regd. No, name, section, a signature column

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #000; font-size: 12px; }
  .page { width: 210mm; padding: 0 12mm; box-sizing: border-box; }
  .pdf-page-header { height: 8mm; }
  .head { display: grid; grid-template-columns: 64px 1fr 64px; align-items: center; margin-top: 2mm; }
  .head img { height: 52px; }
  .center { text-align: center; }
  .college { font-size: 16px; font-weight: bold; margin: 0; text-transform: uppercase; }
  .line { margin: 2px 0; font-size: 13px; }
  .big { font-size: 20px; font-weight: bold; margin: 6px 0 2px; }
  hr { border: 0; border-top: 2px solid #000; margin: 6px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1.2px solid #000; padding: 4px 6px; text-align: center; vertical-align: middle; }
  .grp { font-size: 10px; color: #333; }
  th { background: #eee; font-size: 11.5px; }
  td.l { text-align: left; }
  tr { break-inside: avoid-page; }
  .ranges { margin: 4px 0 8px; font-size: 12px; }
  .ranges span { display: inline-block; border: 1px solid #000; padding: 2px 6px; margin: 2px 4px 2px 0; }
  .sign { display: flex; justify-content: space-between; margin-top: 24px; font-weight: bold; }
  .sig { height: 26px; }
`;

type College = { name: string; logoUrl?: string };

const when = (p: ExamSeatingPlan) => {
  if (!p.examDate) return "";
  const [from, to] = (p.examTime ?? "").split("-");
  return `${dayLabel(p.examDate)}${from && to ? ` · ${timeLabel(from)} - ${timeLabel(to)}` : ""}`;
};

function shell(c: College, p: ExamSeatingPlan, title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header"></div>
    <div class="head"><img src="${logoSrc(c.logoUrl)}" alt="" /><div class="center"><p class="college">${esc(c.name)}</p>
      <p class="line"><b>${esc(p.name)}</b></p>${when(p) ? `<p class="line">${esc(when(p))}</p>` : ""}<p class="big">${esc(title)}</p></div><span></span></div>
    <hr />${body}
  </div></body></html>`;
}

const roomTitle = (r: SeatingRoomAllocation) => `Room ${r.name} · Block ${r.block} · Floor ${r.floor}`;
const ranges = (r: SeatingRoomAllocation) => `<div class="ranges">${rollRangeBySection(r.students).map((g) => `<span>${esc(g.sectionLabel)}: <b>${esc(g.from)} - ${esc(g.to)}</b> (${g.count})</span>`).join("")}</div>`;

export function roomSheetHTML(c: College, p: ExamSeatingPlan, r: SeatingRoomAllocation): string {
  const per = r.perBench ?? 1;
  const rows = benchRows(r).map((row, b) => `<tr><td><b>${b + 1}</b></td>${row.map((s) => `<td>${s ? `<b>${esc(s.rollNumber)}</b> <span class="grp">${esc(s.group ?? s.sectionLabel)}</span>` : "-"}</td>`).join("")}</tr>`).join("");
  const body = `${ranges(r)}<table><thead><tr><th style="width:12%">Bench</th>${Array.from({ length: per }, (_, i) => `<th>Seat ${SEAT_LETTERS[i] ?? i + 1}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <p class="line" style="margin-top:8px">${r.students.length} students</p>`;
  return shell(c, p, roomTitle(r), body);
}

export function noticeBoardHTML(c: College, p: ExamSeatingPlan): string {
  const rows = p.rooms.filter((r) => r.students.length).flatMap((r) => rollRangeBySection(r.students).map((g, i, all) =>
    `<tr>${i === 0 ? `<td rowspan="${all.length}"><b>${esc(r.name)}</b><br/><span style="font-size:10.5px">Block ${esc(r.block)} · Floor ${r.floor}</span></td>` : ""}<td class="l">${esc(g.sectionLabel)}</td><td>${esc(g.from)}</td><td>${esc(g.to)}</td><td>${g.count}</td></tr>`)).join("");
  return shell(c, p, "Seating Arrangement", `<table><thead><tr><th style="width:18%">Room</th><th>Section</th><th>From Regd. No</th><th>To Regd. No</th><th style="width:9%">Count</th></tr></thead><tbody>${rows}</tbody></table>`);
}

export function attendanceSheetHTML(c: College, p: ExamSeatingPlan, r: SeatingRoomAllocation): string {
  const per = r.perBench ?? 1;
  const seated = benchRows(r).flatMap((row, b) => row.map((s, l) => (s ? { s, seat: `${b + 1}${per > 1 ? SEAT_LETTERS[l] : ""}` } : null)).filter((x): x is { s: NonNullable<typeof row[number]>; seat: string } => Boolean(x)));
  const rows = seated.map(({ s, seat }, i) => `<tr><td>${i + 1}</td><td>${seat}</td><td><b>${esc(s.rollNumber)}</b></td><td class="l">${esc(s.name)}</td><td class="l" style="font-size:10.5px">${esc(s.sectionLabel)}</td><td class="sig"></td></tr>`).join("");
  return shell(c, p, `Attendance - ${roomTitle(r)}`, `<table><thead><tr><th style="width:6%">S.No</th><th style="width:9%">Bench</th><th style="width:17%">Regd. No</th><th>Name</th><th style="width:22%">Section</th><th style="width:18%">Signature</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="line" style="margin-top:8px">Present: ______ &nbsp;&nbsp; Absent: ______</p>
    <div class="sign"><span>Invigilator</span><span>Chief Superintendent</span></div>`);
}
