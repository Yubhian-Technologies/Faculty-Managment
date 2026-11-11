import { logoSrc } from "@/lib/pdf/logo";
import { renderMathHtml } from "@/lib/midBank/renderMath";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { choiceText, partMax, patternMax, unitOfQuestion } from "@/lib/midPapers/pattern";
import { ceaPartOf, midMinutes, withoutCea } from "@/lib/cea/paper";
import { PAPER_STYLE, ROMAN } from "@/lib/pdf/midQuestionPaperTemplate";
import type { MidOutcomeSwitches, MidPaperPattern, MidPaperQuestion } from "@/types";

// Print-ready HTML (A4 portrait) for one question paper a faculty member wrote (a college that prepares papers):
// the same header as the Mid question paper (code + Regd. No boxes, letterhead, exam line, subject, branch / date /
// time / max marks), then each part - its heading, "Answer ...", and its questions (MCQ options, OR rows between
// pairs, parts (a), (b) with their marks). CO / BL / PO columns only when the college uses them. With
// `answerKey`, a one-page key of the objective answers instead (Exam Cell only).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const LETTERS = "abcdef";

export interface PaperSetPdfData {
  college: { name: string; logoUrl?: string };
  exam: { courseName: string; year: number; semester: number; semesterInYear?: number | null; midNumber: number; academicYear?: string; date?: string };
  subject: { name: string; code: string; regulation: string };
  branch: string;
  sections: string[];
  pattern: Pick<MidPaperPattern, "parts" | "durationMinutes" | "instruction" | "regdBoxes">;
  set: number;
  questions: MidPaperQuestion[];
  /** The units the paper covers (per-unit parts print a UNIT row before each unit's questions). */
  units?: number[];
  outcomes?: Partial<MidOutcomeSwitches>;
  cos?: { id: string; statement: string }[];
  mapping?: Record<string, string[]>;
  formula?: (latex: string, display: boolean) => string;
  answerKey?: boolean;
  /** Print only this part, as its own sheet with its own header (time + max marks below). Numbers stay as in the full paper. */
  onlyPartId?: string;
  partHeader?: { durationMinutes: number; maxMarks: number };
}

/**
 * The pages a paper set prints as: the Mid paper, and - when it carries a CEA paper (R26 Continuous Evaluation,
 * lib/cea/paper.ts) - that CEA paper as its OWN paper (own header, its minutes, the unit's marks, numbered from 1).
 * Printing one part alone stays one page.
 */
export function paperSetHtmls(d: PaperSetPdfData): string[] {
  const cea = ceaPartOf(d.pattern.parts);
  if (!cea || d.onlyPartId) return [getMidPaperSetHTML(d)];
  return [
    getMidPaperSetHTML({ ...d, pattern: { ...withoutCea(d.pattern), durationMinutes: midMinutes(d.pattern) } }),
    getMidPaperSetHTML({ ...d, onlyPartId: cea.id, partHeader: { durationMinutes: cea.cea!.minutes, maxMarks: partMax(cea) } }),
  ];
}

/** Several printed pages in one document for an on-screen preview (a dashed line between them). */
export function joinPaperHtmls(htmls: string[]): string {
  if (htmls.length <= 1) return htmls[0] ?? "";
  const bodyOf = (h: string) => h.slice(h.indexOf("<body>") + 6, h.lastIndexOf("</body>"));
  const first = htmls[0];
  return first.slice(0, first.lastIndexOf("</body>")) + htmls.slice(1).map((h) => `<div style="border-top:2px dashed #999;margin:28px 0"></div>${bodyOf(h)}`).join("") + "</body></html>";
}

export function getMidPaperSetHTML(d: PaperSetPdfData): string {
  const sw = outcomeSwitches(d.outcomes);
  const extra = [sw.cos && "CO", sw.bloom && "BL", sw.poMapping && "PO"].filter(Boolean) as string[];
  const cols = 3 + extra.length;
  const byId = new Map(d.questions.map((q) => [q.id, q]));
  const regCode = d.subject.regulation.match(/\d+/)?.[0] ?? d.subject.regulation;
  const sem = d.exam.semesterInYear ? `${ROMAN[d.exam.semesterInYear]} SEMESTER` : `SEMESTER ${d.exam.semester}`;
  const course = `${d.exam.courseName.toUpperCase().replace(/\.$/, "")}.`;
  const text = (t: string, img?: string, cap?: string) => `${renderMathHtml(t, d.formula)}${img ? `<img class="qimg" src="${esc(img)}" alt="" />${cap ? `<div class="cap">${esc(cap)}</div>` : ""}` : ""}`;
  const tags = (q?: MidPaperQuestion) => extra.map((x) => {
    if (!q) return `<td class="num"></td>`;
    if (x === "CO") return `<td class="num">${esc(q.cos.map((c) => c.replace(/^CO/, "")).join(", "))}</td>`;
    if (x === "BL") return `<td class="num">${esc(String(q.bloom).replace(/^L/, ""))}</td>`;
    return `<td class="po">${esc(derivePoPso(q.cos, d.mapping ?? {}).map((p) => p.replace(/^PO/, "")).join(", "))}</td>`;
  }).join("");

  let no = 0;
  const only = d.onlyPartId ? d.pattern.parts.find((p) => p.id === d.onlyPartId) : undefined;
  const parts = d.pattern.parts.map((part) => {
    const count = part.flexible ? d.questions.filter((q) => q.set === d.set && q.partId === part.id).length : part.questions;
    // Another part when printing one part alone: only its numbers are counted, so this part's numbers stay the same
    // (a CEA paper is its own paper - numbered from 1).
    if (only && part.id !== only.id) { if (!only.cea) no += count; return ""; }
    let rows = `<tr class="unit"><td colspan="2">${esc(part.label.toUpperCase())} - ${esc(part.title)}<br /><span style="font-weight:normal">${esc(choiceText(part, part.flexible ? count : undefined))}</span></td><td class="num colhead">${partMax(part)} M</td>${extra.map((x) => `<td class="${x === "PO" ? "po" : "num"} colhead">${x}</td>`).join("")}</tr>`;
    for (let i = 1; i <= count; i++) {
      no++;
      const q = byId.get(`${d.set}_${part.id}_${i}`);
      // A faculty-decides part: each question's own kind and marks.
      const kind = q?.kind ?? part.kind;
      const marks = part.flexible ? q?.marks ?? "" : part.marksEach;
      let block = part.choice.kind === "OR_PAIRS" && i % 2 === 0 ? `<tr class="or"><td colspan="${cols}">OR</td></tr>` : "";
      // A per-unit part: a UNIT row before each unit's questions.
      const u = part.perUnit ? unitOfQuestion(part, d.units ?? [], i) : undefined;
      if (u && u !== (i > 1 ? unitOfQuestion(part, d.units ?? [], i - 1) : undefined)) block = `<tr class="unit"><td colspan="${cols}">UNIT-${ROMAN[u] ?? u}</td></tr>` + block;
      if (d.answerKey) {
        const ans = !q ? "" : kind === "MCQ" ? `(${LETTERS[Number(q.answer)] ?? "?"}) ${esc(q.options?.[Number(q.answer)] ?? "")}` : kind === "FILL_BLANK" ? esc(q.answer ?? "") : "<i>Descriptive</i>";
        rows += `<tr><td class="no">${no}</td><td class="q">${ans}</td><td class="num">${marks}</td>${tags(q)}</tr>`;
        continue;
      }
      if (q?.subParts?.length) {
        if (q.text.trim()) block += `<tr><td class="no">${no}</td><td class="q">${text(q.text, q.imageUrl, q.imageCaption)}</td><td class="num"></td>${tags(q)}</tr>`;
        q.subParts.forEach((sp, j) => {
          block += `<tr><td class="no">${!q.text.trim() && j === 0 ? `${no}.` : ""}(${LETTERS[j]})</td><td class="q">${text(sp.text, sp.imageUrl, sp.imageCaption)}</td><td class="num">${sp.marks}</td>${j === 0 && !q.text.trim() ? tags(q) : extra.map(() => `<td class="num"></td>`).join("")}</tr>`;
        });
      } else {
        const opts = kind === "MCQ" && q?.options
          ? `<div class="opts">${q.options.map((o, j) => `<span>(${LETTERS[j]}) ${renderMathHtml(o, d.formula)}</span>`).join("")}</div>` : "";
        block += `<tr><td class="no">${no}</td><td class="q">${q ? text(q.text, q.imageUrl, q.imageCaption) : "<i>(not written)</i>"}${opts}</td><td class="num">${marks}</td>${tags(q)}</tr>`;
      }
      rows += `<tbody class="section">${block}</tbody>`;
    }
    return rows;
  }).join("");

  const used = [...new Set(d.questions.filter((q) => q.set === d.set && (!only || q.partId === only.id)).flatMap((q) => q.cos))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const coList = sw.cos && !d.answerKey ? (d.cos ?? []).filter((c) => used.includes(c.id)).map((c) => `<p><b>${esc(c.id.replace(/^CO/, ""))}.</b> ${esc(c.statement)}</p>`).join("") : "";
  const maxMarks = only ? (d.partHeader?.maxMarks ?? partMax(only)) : patternMax(d.pattern);
  const duration = only ? (d.partHeader?.durationMinutes ?? (only.cea ? only.cea.minutes : midMinutes(d.pattern))) : d.pattern.durationMinutes;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${PAPER_STYLE}
    .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-top: 4px; }
  </style></head><body><div class="page">
    <div class="pdf-page-header"></div>
    <div class="top"><span class="code">${esc(d.subject.code)}</span><span>${regCode ? `<span class="code">${esc(regCode)}</span>` : ""}</span><span class="regd"><span>Regd. No:</span>${"<i></i>".repeat(d.pattern.regdBoxes || 12)}</span></div>
    <div class="head">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div class="center">
        <p class="uni">${esc(d.college.name)}</p>
        <p class="line">${ROMAN[d.exam.year] ?? d.exam.year} ${esc(course)} ${sem} ${only?.cea ? `CONTINUOUS EVALUATION (WITH MID-${d.exam.midNumber})` : `MID-${d.exam.midNumber} EXAMINATION`}${d.answerKey ? " - ANSWER KEY" : ""}</p>
        ${d.exam.academicYear ? `<p class="line">Academic Year: ${esc(d.exam.academicYear)}</p>` : ""}
        <p class="subject">${esc(d.subject.name)}</p>
        ${only ? `<p class="line"><b>${esc(only.label.toUpperCase())}</b></p>` : ""}
      </div><span></span>
    </div>
    <div class="meta"><span>${d.sections.length || d.branch.includes("(") ? "Branch &amp; Sections" : "Branch"}: <b>${esc(d.branch)}${d.sections.length ? ` - ${esc(d.sections.join(", "))}` : ""}</b></span><span>${d.exam.date ? `Date: <b>${dmy(d.exam.date)}</b>` : ""}</span></div>
    <div class="meta"><span>Time: <b>${duration} Mins.</b></span><span>Max. Marks: <b>${maxMarks}</b></span></div>
    <hr />
    ${d.pattern.instruction && !d.answerKey ? `<p class="instr">${esc(d.pattern.instruction)}</p>` : ""}
    ${coList ? `<p class="cos-title">Course Outcomes:</p><div class="cos"><p>Upon the completion of the course, the student will be able to:</p>${coList}</div>` : ""}
    <table><colgroup><col style="width:7%" /><col style="width:${86 - extra.length * 5}%" /><col style="width:7%" />${extra.map(() => `<col style="width:5%" />`).join("")}</colgroup>${parts}</table>
    <p class="end">*****</p>
  </div></body></html>`;
}
