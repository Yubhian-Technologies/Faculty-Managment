import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { pdfFormulaRenderer } from "@/lib/midBank/mathSvg";
import { getMidPaperSetHTML, type PaperSetPdfData } from "@/lib/pdf/midPaperSetTemplate";

// Builds one question paper (or its answer key) as a PDF in the browser; only the letterhead is fetched.
export async function downloadMidPaperSetPdf(data: Omit<PaperSetPdfData, "college" | "formula">, fileName: string): Promise<void> {
  const [info, logoUrl, formula] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; academicYear?: string }>,
    fetchCollegeLogoUrl(),
    pdfFormulaRenderer(),
  ]);
  const html = getMidPaperSetHTML({ ...data, exam: { academicYear: info.academicYear, ...data.exam }, college: { name: info.name || "College", logoUrl }, formula });
  await renderHtmlToPdf(html, `${fileName.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`);
}
