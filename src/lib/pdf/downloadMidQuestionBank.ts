import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { getMidQuestionBankHTML, type MidBankPdfData } from "@/lib/pdf/midQuestionBankTemplate";
import { pdfFormulaRenderer } from "@/lib/midBank/mathSvg";

// Builds the Mid Question Bank PDF in the browser. Everything it prints is
// already on the page (the bank, its questions, the syllabus setup); only the
// college letterhead is fetched.

/** The page's KaTeX rules (loaded with the bank screens), so the PDF iframe draws formulas the same way. */
function katexCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // a cross-origin sheet can't be read
    for (const r of Array.from(rules)) {
      const text = r.cssText;
      if (text.includes(".katex") || (r instanceof CSSFontFaceRule && text.includes("KaTeX"))) out.push(text);
    }
  }
  return out.join("\n");
}

export async function downloadMidQuestionBankPdf(data: Omit<MidBankPdfData, "college" | "katexCss" | "formula">): Promise<void> {
  const [info, logoUrl, formula] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; affiliation?: string; address?: string; academicYear?: string }>,
    fetchCollegeLogoUrl(),
    pdfFormulaRenderer(),
  ]);
  const html = getMidQuestionBankHTML({
    ...data,
    college: { name: info.name || "College", affiliation: info.affiliation, address: info.address, logoUrl, academicYear: info.academicYear },
    katexCss: katexCss(),
    formula,
  });
  const safe = `${data.subject.code}-mid${data.bank.midNumber}-question-bank`.replace(/[^a-zA-Z0-9-_]+/g, "-");
  await renderHtmlToPdf(html, `${safe}.pdf`);
}
