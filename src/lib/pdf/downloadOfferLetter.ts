import { getOfferLetterHTML, type OfferLetterData } from "@/lib/pdf/offerLetterTemplate";
import { renderHtmlToPdf, renderHtmlToPdfBlob } from "@/lib/pdf/htmlToPdf";

export async function downloadOfferLetterPdf(
  data: OfferLetterData,
  filenameHint: string
): Promise<void> {
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "offer-letter";
  await renderHtmlToPdf(getOfferLetterHTML(data), `offer-letter-${safeHint}.pdf`);
}

/** Renders the offer letter to a real PDF and returns it as base64 — for
 *  attaching to the outgoing offer-letter email (see /api/email/send). */
export async function getOfferLetterPdfBase64(data: OfferLetterData): Promise<string> {
  const blob = await renderHtmlToPdfBlob(getOfferLetterHTML(data));
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
