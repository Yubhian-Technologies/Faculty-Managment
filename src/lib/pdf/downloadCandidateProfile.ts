import { auth } from "@/lib/firebase/client";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import type { CandidateProfileData } from "@/lib/pdf/candidateProfileTemplate";

export async function downloadCandidateProfilePdf(data: CandidateProfileData, filenameHint: string): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Your session needs a refresh - reload the page and try again.");
  }

  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "CANDIDATE_PROFILE", data }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Candidate profile generation failed (${res.status})`);
  }

  const html = await res.text();
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "candidate";
  await renderHtmlToPdf(html, `candidate-profile-${safeHint}.pdf`);
}
