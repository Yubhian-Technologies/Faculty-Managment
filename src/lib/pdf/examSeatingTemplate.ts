import { EXAM_HEADER_STYLE, examHeaderHTML } from "@/lib/pdf/examHeader";
import { benchRows } from "@/lib/exams/seatingLayers";
import { rollRangeBySection } from "@/lib/exams/seatingAllocator";
import { SEAT_LETTERS } from "@/lib/exams/seatingPaired";
import { roomRows } from "@/lib/exams/roomLayout";
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
  table.sheet th.mk { font-size: 9.5px; padding: 3px 2px; }
  .sheet-foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; }
  .sheet-sign { display: flex; justify-content: space-between; margin-top: 16px; font-weight: bold; }
  .front { border: 1.2px solid #000; background: #eee; text-align: center; font-weight: bold; padding: 3px; margin-bottom: 4px; letter-spacing: 2px; }
  table.layout { table-layout: fixed; }
  table.layout td { padding: 3px 4px; vertical-align: top; text-align: left; }
  table.layout td.gap { border: 0; width: 3mm; }
  table.layout .bn { font-size: 9.5px; color: #333; }
  table.layout .seat { font-size: 11px; white-space: nowrap; }
  table.layout th { font-size: 10.5px; }
`;

/** The college plus, for the letterhead, the exam line(s) ("I B.TECH. I SEMESTER MID-1 EXAMINATION") and academic year. */
type College = { name: string; logoUrl?: string; examLines?: string[]; academicYear?: string; courseCode?: string };

const ROMAN_YEAR = ["", "I", "II", "III", "IV", "V", "VI"];
/**
 * A section as the exam documents print it: "I B.TECH. AIDS-A" - year, course code,
 * the section's own name (which carries the branch code). From the stored label
 * "Artificial Intelligence and Data Science · 1st Year · AIDS-A".
 */
export function shortSection(label: string, courseCode?: string): string {
  const parts = label.split(" · ");
  const name = parts[parts.length - 1] ?? label;
  const year = Number(/(\d+)/.exec(parts[1] ?? "")?.[1]);
  const code = courseCode ? `${courseCode.toUpperCase().replace(/\.$/, "")}. ` : "";
  return `${year ? `${ROMAN_YEAR[year] ?? year} ` : ""}${code}${name}`;
}
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

/** "Block A, Floor 2, Room 201". */
const roomTitle = (r: SeatingRoomAllocation) => `Block ${r.block}, Floor ${r.floor}, Room ${r.name}`;
const ranges = (c: College, r: SeatingRoomAllocation) => `<div class="ranges">${rollRangeBySection(r.students).map((g) => `<span>${esc(shortSection(g.sectionLabel, c.courseCode))}: <b>${esc(g.from)} - ${esc(g.to)}</b> (${g.count})</span>`).join("")}</div>`;

/**
 * The room as it stands (rooms with bench columns): the board at the front,
 * columns side by side, rows front to back, each bench with its seats' Regd. Nos.
 * Benches are numbered column by column, as they were filled.
 */
function layoutHTML(r: SeatingRoomAllocation, columns: number): string {
  const per = r.perBench ?? 1;
  const benches = r.benches ?? r.capacity;
  const rows = roomRows(benches, columns);
  const byBench = benchRows(r);
  const cell = (n: number) => {
    if (n > benches) return `<td style="border:0"></td>`;
    const seats = byBench[n - 1] ?? [];
    const lines = Array.from({ length: per }, (_, l) => {
      const s = seats[l];
      return `<div class="seat">${per > 1 ? `${SEAT_LETTERS[l] ?? l + 1}: ` : ""}${s ? `<b>${esc(s.rollNumber)}</b>` : "-"}</div>`;
    }).join("");
    return `<td><div class="bn">Bench ${n}</div>${lines}</td>`;
  };
  const cols = Array.from({ length: columns }, (_, i) => i + 1);
  const head = cols.map((k) => `<th>Column ${k}</th>`).join(`<td class="gap"></td>`);
  const body = Array.from({ length: rows }, (_, i) => `<tr>${cols.map((k) => cell((k - 1) * rows + i + 1)).join(`<td class="gap"></td>`)}</tr>`).join("");
  return `<div class="front">FRONT (BOARD)</div><table class="layout"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function roomSheetHTML(c: College, p: ExamSeatingPlan, r: SeatingRoomAllocation): string {
  if (r.columns) {
    const body = `${ranges(c, r)}${layoutHTML(r, r.columns)}<p class="line" style="margin-top:8px">${r.students.length} students</p>`;
    return shell(c, p, roomTitle(r), body);
  }
  const per = r.perBench ?? 1;
  const rows = benchRows(r).map((row, b) => `<tr><td><b>${b + 1}</b></td>${row.map((s) => `<td>${s ? `<b>${esc(s.rollNumber)}</b> <span class="grp">${esc(shortSection(s.sectionLabel, c.courseCode))}</span>` : "-"}</td>`).join("")}</tr>`).join("");
  const body = `${ranges(c, r)}<table><thead><tr><th style="width:12%">Bench</th>${Array.from({ length: per }, (_, i) => `<th>Seat ${SEAT_LETTERS[i] ?? i + 1}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <p class="line" style="margin-top:8px">${r.students.length} students</p>`;
  return shell(c, p, roomTitle(r), body);
}

export function noticeBoardHTML(c: College, p: ExamSeatingPlan): string {
  const rows = p.rooms.filter((r) => r.students.length).flatMap((r) => rollRangeBySection(r.students).map((g, i, all) =>
    `<tr>${i === 0 ? `<td rowspan="${all.length}"><b>${esc(roomTitle(r))}</b></td>` : ""}<td class="l">${esc(shortSection(g.sectionLabel, c.courseCode))}</td><td>${esc(g.from)}</td><td>${esc(g.to)}</td><td>${g.count}</td></tr>`)).join("");
  return shell(c, p, "Seating Arrangement", `<table><thead><tr><th style="width:26%">Room</th><th>Section</th><th>From Regd. No</th><th>To Regd. No</th><th style="width:9%">Count</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/**
 * One exam of one branch on one day (from the Mid timetable): subject(s), time, and
 * the marks columns - the subject's components from Mid Configuration > Marks.
 */
export interface SheetExam { date: string; time: string; subjects: { name: string; code: string; id?: string }[]; marks?: { name: string; maxMarks: number }[] }

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
    // The branch is in the header, so the section(s) are too ("CSBS-A, CSBS-B") - no Section column.
    const sectionOnly = (label: string) => label.split(" · ").pop() ?? label;
    const sections = [...new Set(list.map(({ s }) => sectionOnly(s.sectionLabel)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const [from, to] = (exam?.time ?? "").split("-");
    const facts = [
      exam ? ["Subject", exam.subjects.map((x) => `${esc(x.name)} (${esc(x.code)})`).join(" / ")] : null,
      exam ? ["Date &amp; time", `${esc(dayLabel(exam.date))}${from && to ? ` · ${timeLabel(from)} - ${timeLabel(to)}` : ""}`] : null,
      ["Room", esc(roomTitle(r))],
      ["Branch", esc(group)],
      sections.length ? [sections.length > 1 ? "Sections" : "Section", esc(sections.join(", "))] : null,
    ].filter((x): x is string[] => Boolean(x));
    // A column per configured component (+ Total when there are several); none configured = one Marks column.
    const marks = exam?.marks?.length ? exam.marks : [];
    const markHeads = marks.length
      ? [...marks.map((m) => `${esc(m.name)}<br>(${m.maxMarks})`), ...(marks.length > 1 ? [`Total<br>(${marks.reduce((n, m) => n + m.maxMarks, 0)})`] : [])]
      : ["Marks"];
    const markWidth = Math.max(6, Math.min(10, Math.floor(36 / markHeads.length)));
    const rows = list.map(({ s }, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.rollNumber)}</b></td><td class="l">${esc(s.name)}</td><td></td><td class="sig"></td>${markHeads.map(() => "<td></td>").join("")}</tr>`).join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
      <div class="pdf-page-header"></div>
      ${examHeaderHTML({ college: c, lines: lines(c, p), academicYear: c.academicYear, title: "Signature Sheet" })}
      <table class="facts"><tbody>${facts.map(([k, v]) => `<tr><th style="width:22%;text-align:left">${k}</th><td class="l"><b>${v}</b></td></tr>`).join("")}</tbody></table>
      <table class="sheet" style="margin-top:8px"><thead><tr><th style="width:6%">S.No</th><th style="width:14%">Regd. No</th><th>Name</th><th class="mk" style="width:9%">No. of<br>Additional<br>Sheets</th><th style="width:15%">Signature</th>${markHeads.map((h) => `<th class="mk" style="width:${markWidth}%">${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
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
