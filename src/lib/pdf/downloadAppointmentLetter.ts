import { getAppointmentLetterHTML } from "@/lib/pdf/offerLetterTemplate";
import { renderHtmlToPdf, renderHtmlToPdfBlob } from "@/lib/pdf/htmlToPdf";

type AppointmentLetterData = Parameters<typeof getAppointmentLetterHTML>[0];

export async function downloadAppointmentLetterPdf(
  data: AppointmentLetterData,
  filenameHint: string
): Promise<void> {
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "appointment-letter";
  await renderHtmlToPdf(getAppointmentLetterHTML(data), `appointment-letter-${safeHint}.pdf`);
}

/** Renders the appointment letter to a real PDF and returns it as base64 — for
 *  attaching to the outgoing appointment-letter email (see /api/email/send). */
export async function getAppointmentLetterPdfBase64(data: AppointmentLetterData): Promise<string> {
  const blob = await renderHtmlToPdfBlob(getAppointmentLetterHTML(data));
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
