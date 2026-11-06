import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf, renderMultiHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { pdfFormulaRenderer } from "@/lib/midBank/mathSvg";
import { getMidPaperSetHTML, type PaperSetPdfData } from "@/lib/pdf/midPaperSetTemplate";
import type { MidPaperFinal, MidPaperQuestion } from "@/types";

const safeName = (n: string) => `${n.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`;

async function letterhead() {
  const [info, logoUrl, formula] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; academicYear?: string }>,
    fetchCollegeLogoUrl(),
    pdfFormulaRenderer(),
  ]);
  return { info, college: { name: info.name || "College", logoUrl }, formula };
}

// Builds one question paper (or its answer key) as a PDF in the browser; only the letterhead is fetched.
export async function downloadMidPaperSetPdf(data: Omit<PaperSetPdfData, "college" | "formula">, fileName: string): Promise<void> {
  const { info, college, formula } = await letterhead();
  const html = getMidPaperSetHTML({ ...data, exam: { academicYear: info.academicYear, ...data.exam }, college, formula });
  await renderHtmlToPdf(html, safeName(fileName));
}

/**
 * The FINALIZED paper (the frozen copy the Exam Cell printed), laid out as it was finalized: all parts on one paper,
 * or each part on its own page(s) with its own header (time + max marks). `answerKey` = the objective answers.
 */
export async function downloadMidPaperFinalPdf(final: MidPaperFinal, opts: { answerKey?: boolean; fileName: string }): Promise<void> {
  const { college, formula } = await letterhead();
  const base: PaperSetPdfData = {
    college, formula, answerKey: opts.answerKey,
    exam: final.exam, subject: final.subject, branch: final.branchCode, sections: final.sections, pattern: final.pattern,
    set: final.setNo, units: final.units, questions: final.questions as unknown as MidPaperQuestion[],
    outcomes: final.outcomes, cos: final.cos, mapping: final.mapping,
  };
  if (!final.layout.separateParts || final.pattern.parts.length < 2) {
    await renderHtmlToPdf(getMidPaperSetHTML(base), safeName(opts.fileName));
    return;
  }
  // One document per part: each starts on a new page with the full header (Regd. No boxes, letterhead, exam line).
  const htmls = final.pattern.parts.map((p) => {
    const h = final.layout.parts?.find((x) => x.partId === p.id);
    return getMidPaperSetHTML({ ...base, onlyPartId: p.id, ...(h ? { partHeader: { durationMinutes: h.durationMinutes, maxMarks: h.maxMarks } } : {}) });
  });
  await renderMultiHtmlToPdf(htmls, safeName(opts.fileName));
}
