import { auth } from "@/lib/firebase/client";

export async function downloadResumePdf(record: Record<string, unknown>, filenameHint: string): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/pdf/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "RESUME", data: record }),
  });
  if (!res.ok) throw new Error("Resume generation failed");

  const blob = await res.blob();
  if (!blob.type.includes("pdf")) {
    throw new Error("PDF generation is unavailable right now — please try again shortly.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeHint = filenameHint.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
  link.download = `resume-${safeHint}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
