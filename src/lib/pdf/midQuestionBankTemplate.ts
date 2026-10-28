import { logoSrc } from "@/lib/pdf/logo";
import { renderMathHtml } from "@/lib/midBank/renderMath";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { QUESTIONS_PER_UNIT } from "@/lib/midBank/constants";
import { allowedFormats, formatOf, partLetter, partMarks } from "@/lib/midBank/validateQuestion";
import type { MidQuestion, MidQuestionBank, SubjectOutcomes } from "@/types";

// The Mid Question Bank as a print-ready A4 document (rendered to PDF in the
// browser by htmlToPdf): college letterhead, subject and Mid, then each unit's
// questions with marks, COs, the POs/PSOs they reach and the Bloom level.
// Formulas are KaTeX HTML; `katexCss` is the page's KaTeX stylesheet, copied in
// so the iframe the PDF is drawn from renders them the same as the screen.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; font-size: 12px; }
  img.mj { display: inline-block; margin: 0 1px; }
  .mj-display { display: block; text-align: center; margin: 6px 0; }
  .mj-display img { display: inline-block; }
  .page { width: 210mm; padding: 14mm 15mm; box-sizing: border-box; }
  .pdf-page-header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px; }
  .pdf-page-header img { height: 48px; }
  .college { font-size: 17px; font-weight: bold; color: #1e3a8a; margin: 0; }
  .sub { font-size: 11px; color: #444; margin: 2px 0 0; }
  h1 { font-size: 15px; text-align: center; margin: 6px 0 2px; }
  .meta { text-align: center; font-size: 11px; color: #333; margin-bottom: 10px; }
  .section-title { font-size: 13px; font-weight: bold; background: #eef2ff; padding: 5px 8px; margin: 14px 0 6px; break-after: avoid-page; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 6px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
  th { background: #f3f4f6; font-size: 11px; }
  tr { break-inside: avoid-page; }
  .num { width: 34px; text-align: center; }
  .narrow { width: 52px; text-align: center; font-size: 11px; }
  .po { width: 90px; font-size: 10px; }
  .part { margin: 0 0 6px; }
  .part:last-child { margin-bottom: 0; }
  .img { max-width: 100%; max-height: 160px; display: block; margin-top: 4px; }
  .cap { font-size: 10px; color: #555; }
  .cos td { font-size: 11px; }
  .katex { font-size: 1.05em; }
`;

export interface MidBankPdfData {
  college: { name: string; affiliation?: string; address?: string; logoUrl?: string };
  subject: { name: string; code: string; courseName: string; regulation: string; year: number; semester: number | null; department: string };
  facultyName: string;
  bank: Pick<MidQuestionBank, "midNumber" | "units" | "format" | "marks">;
  outcomes: Pick<SubjectOutcomes, "units" | "cos" | "mapping">;
  questions: MidQuestion[];
  katexCss: string;
  /** How formulas are drawn (the PDF passes MathJax SVG images - see mathSvg.ts); KaTeX when absent. */
  formula?: (latex: string, display: boolean) => string;
}

export function getMidQuestionBankHTML(d: MidBankPdfData): string {
  const byId = new Map(d.questions.map((q) => [q.id, q]));
  const unitTitle = (u: number) => d.outcomes.units.find((x) => x.no === u)?.title ?? "";

  const unitTables = d.bank.units.map((u) => {
    const rows = Array.from({ length: QUESTIONS_PER_UNIT }, (_, i) => i + 1).map((slot) => {
      const q = byId.get(`${u}_${slot}`);
      if (!q) return "";
      const f = formatOf(q, allowedFormats(d.bank));
      const cell = (fn: (p: MidQuestion["parts"][number], i: number) => string) => q.parts.map((p, i) => `<div class="part">${fn(p, i)}</div>`).join("");
      return `<tr>
        <td class="num">${slot}</td>
        <td>${cell((p, i) => `${f !== "SINGLE" ? `<b>(${partLetter(i)})</b> ` : ""}${renderMathHtml(p.text, d.formula)}${p.imageUrl ? `<img class="img" src="${esc(p.imageUrl)}" alt="" />${p.imageCaption ? `<div class="cap">${esc(p.imageCaption)}</div>` : ""}` : ""}`)}</td>
        <td class="narrow">${cell((p, i) => String(partMarks(p, i, f, d.bank.marks)))}</td>
        <td class="narrow">${cell((p) => esc(p.cos.join(", ")))}</td>
        <td class="po">${cell((p) => esc(derivePoPso(p.cos, d.outcomes.mapping).join(", ")))}</td>
        <td class="narrow">${cell((p) => esc(p.bloom))}</td>
      </tr>`;
    }).join("");
    return `<div class="section-title">Unit ${u}${unitTitle(u) ? ` - ${esc(unitTitle(u))}` : ""}</div>
      <table><thead><tr><th class="num">Q</th><th>Question</th><th class="narrow">Marks</th><th class="narrow">CO</th><th class="po">PO / PSO</th><th class="narrow">Bloom</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");

  const coTable = `<div class="section-title">Course Outcomes</div>
    <table class="cos"><tbody>${d.outcomes.cos.map((c) => `<tr><td class="narrow"><b>${esc(c.id)}</b></td><td>${esc(c.statement)}</td></tr>`).join("")}</tbody></table>`;

  const s = d.subject;
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${d.katexCss}</style><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div><p class="college">${esc(d.college.name)}</p>${d.college.affiliation ? `<p class="sub">${esc(d.college.affiliation)}</p>` : ""}${d.college.address ? `<p class="sub">${esc(d.college.address)}</p>` : ""}</div>
    </div>
    <h1>Mid ${d.bank.midNumber} Question Bank</h1>
    <div class="meta">${esc(s.name)} (${esc(s.code)}) · ${esc(s.courseName)}${s.regulation ? ` · ${esc(s.regulation)}` : ""} · Year ${s.year}${s.semester ? `, Sem ${s.semester}` : ""} · ${esc(s.department)}<br/>
      Units ${d.bank.units.join(", ")} · Prepared by ${esc(d.facultyName)}</div>
    ${coTable}
    ${unitTables}
  </div></body></html>`;
}
