import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { ExamGuidelineFileType } from "@/types/examGuidelines";

// Best-effort only, by design (see the upload UI's copy): a line of raw
// extracted text becomes one point. PDF/Word text extraction doesn't know
// which lines were visually a bullet list vs a wrapped paragraph, so a
// document that isn't already formatted as short lines/bullets will come out
// as one point per paragraph rather than a clean list.
export function splitIntoPoints(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•*•‣◦⁃∙▪●○◦\-–—]+/, "").replace(/^\(?\d+[.)]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

export async function extractTextFromFile(buffer: Buffer, fileType: ExamGuidelineFileType): Promise<string> {
  if (fileType === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
