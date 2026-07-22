import { auth } from "@/lib/firebase/client";

export async function downloadOfferLetterPdf(
  data: {
    candidateName: string;
    designation: string;
    department: string;
    joiningDate: string;
    ctcAnnual: number;
    ctcMonthly: number;
    subjects?: string[];
    collegeName: string;
    collegeAddress?: string;
    letterDate: string;
  },
  filenameHint: string
): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "OFFER_LETTER", data }),
  });
  if (!res.ok) throw new Error("PDF generation failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "offer-letter";
  // Falls back to an .html download when puppeteer isn't available server-side (see AGENTS.md).
  link.download = `offer-letter-${safeHint}.${blob.type.includes("pdf") ? "pdf" : "html"}`;
  link.click();
  URL.revokeObjectURL(url);
}
