import { EXAM_HEADER_STYLE, examHeaderHTML } from "@/lib/pdf/examHeader";
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

const STYLE = `${EXAM_HEADER_STYLE}
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
  .sig { height: 22px; }
  table.sheet td { padding: 3px 5px; font-size: 11px; }
  .sheet-foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; }
  .sheet-sign { display: flex; justify-content: space-between; margin-top: 16px; font-weight: bold; }
`;

/** The college plus, for the letterhead, the exam line(s) ("I B.TECH. I SEMESTER MID-1 EXAMINATION") and academic year. */
type College = { name: string; logoUrl?: string; examLines?: string[]; academicYear?: string };
const lines = (c: College, p: ExamSeatingPlan) => (c.examLines?.length ? c.examLines : [p.name]);

/** "Fri 2 Oct 2026 - Thu 8 Oct 2026 · 10:00 AM - 11:30 AM" - the Mid's exam days (one arrangement for all of them). */
export function seatingWhen(p: Pick<ExamSeatingPlan, "examDays" | "examDate" | "examTime">): string {
  const days = p.examDays?.length ? p.examDays : p.examDate ? [p.examDate] : [];
  if (!days.length) return "";
  const [from, to] = (p.examTime ?? "").split("-");
  const range = days.length === 1 ? dayLabel(days[0]) : `${dayLabel(days[0])} - ${dayLabel(days[days.length - 1])}`;
  return `${range}${from && to ? ` · ${timeLabel(from)} - ${timeLabel(to)}` : ""}`;
}
const when = seatingWhen;

function shell(c: College, p: ExamSeatingPlan, title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header"></div>
    ${examHeaderHTML({ college: c, lines: lines(c, p), academicYear: c.academicYear, title, meta: when(p) ? [["", `<b>${esc(when(p))}</b>`]] : undefined })}${body}
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

/** One exam of one branch on one day (from the Mid timetable): subject(s) and time. */
export interface SheetExam { date: string; time: string; subjects: { name: string; code: string }[] }

/**
 * Signature sheets - one per exam day + subject x room x branch (paired plans
 * built from a Mid timetable: `examsOf(group)` gives that branch's exams), or
 * one per room x branch when there is no timetable. Each lists only that
 * branch's students in that room, in bench order, with a signature column.
 */
export function signatureSheetsHTML(c: College, p: ExamSeatingPlan, examsOf?: (group: string) => SheetExam[]): string[] {
  const out: string[] = [];
  const rooms = p.rooms.filter((r) => r.students.length);
  const groupOf = (s: SeatingRoomAllocation["students"][number]) => s.group ?? p.sections.find((x) => x.id === s.sectionId)?.department ?? s.sectionLabel;
  const seatedIn = (r: SeatingRoomAllocation) => {
    const per = r.perBench ?? 1;
    return benchRows(r).flatMap((row, b) => row.flatMap((s, l) => (s ? [{ s, seat: `${b + 1}${per > 1 ? SEAT_LETTERS[l] : ""}` }] : [])));
  };
  const groupsIn = (r: SeatingRoomAllocation) => [...new Set(seatedIn(r).map(({ s }) => groupOf(s)))];
  const sheet = (r: SeatingRoomAllocation, group: string, exam: SheetExam | null) => {
    const list = seatedIn(r).filter(({ s }) => groupOf(s) === group);
    const [from, to] = (exam?.time ?? "").split("-");
    const facts = [
      exam ? ["Subject", exam.subjects.map((x) => `${esc(x.name)} (${esc(x.code)})`).join(" / ")] : null,
      exam ? ["Date &amp; time", `${esc(dayLabel(exam.date))}${from && to ? ` · ${timeLabel(from)} - ${timeLabel(to)}` : ""}`] : null,
      ["Room", esc(roomTitle(r))],
      ["Branch", esc(group)],
    ].filter((x): x is string[] => Boolean(x));
    // The branch is in the header - the Section column needs only the section ("CSBS-A"), keeping rows one line.
    const sectionOnly = (label: string) => label.split(" · ").pop() ?? label;
    const rows = list.map(({ s, seat }, i) => `<tr><td>${i + 1}</td><td>${seat}</td><td><b>${esc(s.rollNumber)}</b></td><td class="l">${esc(s.name)}</td><td>${esc(sectionOnly(s.sectionLabel))}</td><td class="sig"></td></tr>`).join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
      <div class="pdf-page-header"></div>
      ${examHeaderHTML({ college: c, lines: lines(c, p), academicYear: c.academicYear, title: "Signature Sheet" })}
      <table class="facts"><tbody>${facts.map(([k, v]) => `<tr><th style="width:22%;text-align:left">${k}</th><td class="l"><b>${v}</b></td></tr>`).join("")}</tbody></table>
      <table class="sheet" style="margin-top:8px"><thead><tr><th style="width:6%">S.No</th><th style="width:7%">Bench</th><th style="width:15%">Regd. No</th><th>Name</th><th style="width:10%">Section</th><th style="width:19%">Signature</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sheet-foot"><span>Total: ${list.length} &nbsp;&nbsp; Present: ______ &nbsp;&nbsp; Absent: ______</span></div>
      <div class="sheet-sign"><span>Invigilator</span><span>Chief Superintendent</span></div>
    </div></body></html>`;
  };

  if (examsOf) {
    const days = [...new Set(rooms.flatMap((r) => groupsIn(r).flatMap((g) => examsOf(g).map((e) => e.date))))].sort();
    for (const day of days) for (const r of rooms) for (const g of groupsIn(r)) {
      for (const exam of examsOf(g).filter((e) => e.date === day)) out.push(sheet(r, g, exam));
    }
    if (out.length) return out;
  }
  for (const r of rooms) for (const g of groupsIn(r)) out.push(sheet(r, g, null));
  return out;
}
