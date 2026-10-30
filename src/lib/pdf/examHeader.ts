import { logoSrc } from "@/lib/pdf/logo";

// The letterhead of every Exam Cell Mid document (question paper, timetables,
// seating sheets): logo on the left; centred the college name, the exam line
// ("I B.TECH. I SEMESTER MID-1 EXAMINATION"), "Academic Year: 2026-27" and the
// document's title in bold capitals; then an optional row of left / right facts
// over a rule.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export const EXAM_HEADER_STYLE = `
  .eh { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; font-family: Arial, Helvetica, sans-serif; }
  .eh img { height: 70px; }
  .eh-c { text-align: center; }
  .eh-name { font-size: 20px; font-weight: bold; margin: 0 0 4px; text-transform: uppercase; }
  .eh-line { font-size: 14px; margin: 2px 0; }
  .eh-title { font-size: 14px; font-weight: bold; margin: 3px 0 0; text-transform: uppercase; }
  .eh-meta { display: flex; justify-content: space-between; margin: 6px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; }
  .eh-rule { border: 0; border-top: 2px solid #000; margin: 6px 0 10px; }
`;

export interface ExamOf { courseCode: string; year: number; semester: number; semesterInYear?: number | null; midNumber: number }

/** "I B.TECH. I SEMESTER MID-1 EXAMINATION" (the semester of the year when known, else "SEMESTER 3"). */
export function examLine(e: ExamOf): string {
  const sem = e.semesterInYear ? `${ROMAN[e.semesterInYear]} SEMESTER` : `SEMESTER ${e.semester}`;
  return `${ROMAN[e.year] ?? e.year} ${e.courseCode.toUpperCase().replace(/\.$/, "")}. ${sem} MID-${e.midNumber} EXAMINATION`;
}

export function examHeaderHTML(d: {
  college: { name: string; logoUrl?: string };
  /** The exam line; several (e.g. two years seated together) print one under another. */
  lines?: string[];
  academicYear?: string;
  title: string;
  /** Facts under the title: [left, right] pairs (HTML allowed - escape values yourself). */
  meta?: [string, string][];
}): string {
  return `<div class="eh"><img src="${logoSrc(d.college.logoUrl)}" alt="College logo" /><div class="eh-c">
      <p class="eh-name">${esc(d.college.name)}</p>
      ${(d.lines ?? []).filter(Boolean).map((l) => `<p class="eh-line">${esc(l)}</p>`).join("")}
      ${d.academicYear ? `<p class="eh-line">Academic Year: ${esc(d.academicYear)}</p>` : ""}
      <p class="eh-title">${esc(d.title)}</p>
    </div><span></span></div>
    ${(d.meta ?? []).map(([l, r]) => `<div class="eh-meta"><span>${l}</span><span>${r}</span></div>`).join("")}
    <hr class="eh-rule" />`;
}
