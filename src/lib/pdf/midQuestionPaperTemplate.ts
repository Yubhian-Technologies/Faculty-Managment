import { logoSrc } from "@/lib/pdf/logo";
import { renderMathHtml } from "@/lib/midBank/renderMath";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { partMarks } from "@/lib/midBank/validateQuestion";
import { DEFAULT_REGD_BOXES } from "@/lib/midPaper/rules";
import type { GeneratedPaper, GeneratedPapers } from "@/lib/midPaper/clientTypes";

// Print-ready HTML (A4 portrait) for one Mid question paper, laid out like the
// college's own: code box + Regd. No boxes, letterhead, "I YEAR B.TECH I SEMESTER
// MID-1 EXAMINATION", academic year, subject, branch & sections / date / time /
// max marks, the instruction, the Course Outcomes used, then UNIT rows and the
// three OR-pairs with Marks, CO, BL and PO columns.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

const STYLE = `
  body { font-family: "Times New Roman", Times, serif; margin: 0; color: #000; font-size: 14px; }
  /* No bottom padding: anything after the last line would start an empty page. */
  .page { width: 210mm; padding: 0 12mm; box-sizing: border-box; }
  /* Blank band the PDF maker stamps at the top of EVERY page (.pdf-page-header) - the top margin, page 2 too. */
  .pdf-page-header { height: 8mm; }
  .colhead { font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: 13px; text-align: center; }
  .top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; margin: 2mm 0 6px; font-family: Arial, Helvetica, sans-serif; }
  .top > :first-child { justify-self: start; }
  .top > :last-child { justify-self: end; }
  .code { border: 1.5px solid #000; padding: 4px 14px; font-weight: bold; font-size: 15px; }
  .regd { display: flex; border: 1px solid #000; font-size: 13px; }
  .regd span { padding: 3px 6px; border-right: 1px solid #000; }
  .regd i { width: 17px; border-right: 1px solid #000; }
  .regd i:last-child { border-right: 0; }
  .head { display: grid; grid-template-columns: 80px 1fr 80px; align-items: center; font-family: Arial, Helvetica, sans-serif; }
  .head img { height: 64px; }
  .center { text-align: center; }
  .uni { font-size: 17px; font-weight: bold; margin: 0 0 4px; text-transform: uppercase; }
  .line { margin: 2px 0; font-size: 14px; }
  .subject { font-weight: bold; text-transform: uppercase; margin: 2px 0 0; }
  .meta { display: flex; justify-content: space-between; margin: 6px 36px 0 110px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; }
  hr { border: 0; border-top: 2px solid #000; margin: 6px 0 10px; }
  .instr { margin: 4px 0 8px; }
  .cos-title { font-weight: bold; margin: 8px 0 2px; }
  .cos p { margin: 2px 0; }
  /* Fixed columns in the college paper's proportions - the question gets most of the width. */
  table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  th, td { border: 1.5px solid #000; padding: 5px 7px; vertical-align: middle; overflow-wrap: anywhere; line-height: 1.3; }
  td.q { font-size: 14.5px; text-align: justify; }
  th { font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
  .unit td { font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: 13px; }
  .or td { text-align: center; font-family: Arial, Helvetica, sans-serif; font-weight: bold; }
  .no { text-align: center; font-family: Arial, Helvetica, sans-serif; font-weight: bold; }
  .num { text-align: center; }
  .po { text-align: center; }
  .q img.qimg { display: block; max-width: 100%; max-height: 170px; margin-top: 6px; }
  .cap { font-size: 11px; color: #333; }
  tr { break-inside: avoid-page; }
  .end { text-align: center; font-weight: bold; margin: 6px 0 0; letter-spacing: 2px; }
  img.mj { display: inline-block; margin: 0 1px; }
  .mj-display { display: block; text-align: center; margin: 6px 0; }
`;

/** Section names that already carry the branch ("CSBS-A") as just "A". */
export function shortSections(p: Pick<GeneratedPaper, "sections" | "branchCode">): string[] {
  const prefix = p.branchCode.toLowerCase();
  return p.sections.map((x) => (prefix && x.toLowerCase().startsWith(prefix) ? x.slice(prefix.length).replace(/^[\s-]+/, "") || x : x));
}

export function paperFileName(h: GeneratedPapers["header"], p: GeneratedPaper): string {
  const reg = (p.regulation.match(/\d+/)?.[0] ?? p.regulation) || "R";
  const parts = [`MID${h.midNumber}`, h.academicYear, reg, h.courseCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    `${ROMAN[h.year] ?? h.year}-${h.semesterInYear ? ROMAN[h.semesterInYear] : h.semester}`, p.branchCode, p.subjectCode,
    p.subjectName.replace(/\s+/g, "-"), `Sec-${shortSections(p).join("-")}`];
  return `${parts.join("_").replace(/[^A-Za-z0-9_\-]+/g, "-")}.pdf`;
}

export function getMidQuestionPaperHTML(d: {
  college: { name: string; logoUrl?: string }; header: GeneratedPapers["header"]; paper: GeneratedPaper;
  formula?: (latex: string, display: boolean) => string;
}): string {
  const { header: h, paper: p } = d;
  const qs = p.picked.map((id) => p.questions[id]);
  const regCode = p.regulation.match(/\d+/)?.[0] ?? p.regulation;
  const coText = (cos: string[]) => esc(cos.map((c) => c.replace(/^CO/, "")).join(", "));
  const poText = (cos: string[]) => esc(derivePoPso(cos, p.mapping).map((x) => x.replace(/^PO/, "")).join(", "));
  const body = (text: string, img?: string, cap?: string) =>
    `${renderMathHtml(text, d.formula)}${img ? `<img class="qimg" src="${esc(img)}" alt="" />${cap ? `<div class="cap">${esc(cap)}</div>` : ""}` : ""}`;

  // Each question (with the OR / UNIT rows above it) is one <tbody class="section">, so a
  // page break never splits a question's parts; the column labels are plain bold
  // cells, so the PDF maker doesn't repeat "UNIT-I | Marks ..." on later pages.
  let rows = "";
  qs.forEach((q, i) => {
    const no = i + 1;
    const firstOfPair = i % 2 === 0;
    // "OR" travels with the question after it - never left alone at the foot of a page.
    let block = firstOfPair ? "" : `<tr class="or"><td colspan="6">OR</td></tr>`;
    if (firstOfPair || q.unit !== qs[i - 1].unit) {
      block += `<tr class="unit"><td colspan="2">UNIT-${ROMAN[q.unit] ?? q.unit}</td>${i === 0 ? `<td class="num colhead">Marks</td><td class="num colhead">CO</td><td class="num colhead">BL</td><td class="po colhead">PO</td>` : `<td colspan="4"></td>`}</tr>`;
    }
    const single = q.parts.length === 1;
    q.parts.forEach((part, j) => {
      const label = single ? `${no}` : `${no}.${"abcde"[j]}`;
      block += `<tr><td class="no">${label}</td><td class="q">${body(part.text, part.imageUrl, part.imageCaption)}</td><td class="num">${partMarks(part, j, q.format ?? (single ? "SINGLE" : "PARTS_AB"), p.marks)}</td><td class="num">${coText(part.cos)}</td><td class="num">${esc(part.bloom.replace(/^L/, ""))}</td><td class="po">${poText(part.cos)}</td></tr>`;
    });
    rows += `<tbody class="section">${block}</tbody>`;
  });

  const used = [...new Set(qs.flatMap((q) => q.parts.flatMap((x) => x.cos)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const coList = p.cos.filter((c) => used.includes(c.id)).map((c) => `<p><b>${esc(c.id.replace(/^CO/, ""))}.</b> ${esc(c.statement)}</p>`).join("");
  const sem = h.semesterInYear ? `${ROMAN[h.semesterInYear]} SEMESTER` : `SEMESTER ${h.semester}`;
  // "B.Tech" -> "B.TECH." ("I B.TECH. I SEMESTER MID-1 EXAMINATION").
  const courseLabel = `${h.courseCode.toUpperCase().replace(/\.$/, "")}.`;
  const sections = shortSections(p);

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body><div class="page">
    <div class="pdf-page-header"></div>
    <div class="top"><span class="code">${esc(p.subjectCode)}</span><span>${regCode ? `<span class="code">${esc(regCode)}</span>` : ""}</span><span class="regd"><span>Regd. No:</span>${"<i></i>".repeat(p.regdBoxes || DEFAULT_REGD_BOXES)}</span></div>
    <div class="head">
      <img src="${logoSrc(d.college.logoUrl)}" alt="College logo" />
      <div class="center">
        <p class="uni">${esc(d.college.name)}</p>
        <p class="line">${ROMAN[h.year] ?? h.year} ${esc(courseLabel)} ${sem} MID-${h.midNumber} EXAMINATION</p>
        ${h.academicYear ? `<p class="line">Academic Year: ${esc(h.academicYear)}</p>` : ""}
        <p class="subject">${esc(p.subjectName)}</p>
      </div><span></span>
    </div>
    <div class="meta"><span>Branch &amp; Sections: <b>${esc(p.branchCode)}${sections.length ? ` - ${esc(sections.join(", "))}` : ""}</b></span><span>Date: <b>${dmy(h.date)}</b></span></div>
    <div class="meta"><span>Time: <b>${h.minutes ? `${h.minutes}Mins.` : ""}</b></span><span>Max. Marks: <b>${p.maxMarks}</b></span></div>
    <hr />
    <p class="instr">${esc(p.instruction)}</p>
    ${coList ? `<p class="cos-title">Course Outcomes:</p><div class="cos"><p>Upon the completion of the course, the student will be able to:</p>${coList}</div>` : ""}
    <table><colgroup><col style="width:7%" /><col style="width:59%" /><col style="width:8%" /><col style="width:6%" /><col style="width:6%" /><col style="width:14%" /></colgroup>${rows}</table>
    <p class="end">*****</p>
  </div></body></html>`;
}
