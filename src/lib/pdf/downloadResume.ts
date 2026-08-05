import { auth } from "@/lib/firebase/client";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";

export async function downloadResumePdf(record: Record<string, unknown>, filenameHint: string): Promise<void> {
  // Distinct from the app's httpOnly session cookie that gates every page/API
  // route - this route authenticates via the client-side Firebase Auth SDK
  // instead (see AGENTS.md's PDF generation notes), so the two can desync:
  // e.g. the SDK hasn't finished rehydrating its session yet, or its local
  // persistence got cleared while the cookie is still valid. When that
  // happens `currentUser` is null even though the rest of the app still
  // treats the user as logged in.
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Your session needs a refresh - reload the page and try again.");
  }

  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "RESUME", data: record }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Resume generation failed (${res.status})`);
  }

  // The route returns the resume as HTML (see AGENTS.md - no headless-browser
  // dependency server-side); it's converted into a real, downloadable PDF here
  // in the browser instead.
  const html = await res.text();
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
  await renderHtmlToPdf(html, `resume-${safeHint}.pdf`);
}
