import { auth } from "@/lib/firebase/client";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import type { getDocumentAcknowledgementHTML } from "@/lib/pdf/documentAcknowledgementTemplate";

export async function downloadDocumentAcknowledgementPdf(
  data: Parameters<typeof getDocumentAcknowledgementHTML>[0],
  filenameHint: string
): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Your session needs a refresh — reload the page and try again.");
  }

  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "DOCUMENT_ACKNOWLEDGEMENT", data }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Acknowledgement generation failed (${res.status})`);
  }

  // The route returns the acknowledgement as HTML (see AGENTS.md — no headless-browser
  // dependency server-side); it's converted into a real, downloadable PDF here in the browser.
  const html = await res.text();
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "acknowledgement";
  await renderHtmlToPdf(html, `acknowledgement-${safeHint}.pdf`);
}
