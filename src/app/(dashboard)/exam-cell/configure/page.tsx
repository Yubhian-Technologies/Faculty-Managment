import { redirect } from "next/navigation";

// Exam Configuration (Internal / External marks) now lives on Mid Configuration's
// "Marks" tab; old links - and the dashboard's per-branch ones - land there with
// the same course / year / exam type picked.
export default async function ExamConfigureRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const params = new URLSearchParams({ tab: "marks" });
  for (const [k, v] of Object.entries(q)) if (typeof v === "string" && k !== "tab") params.set(k, v);
  redirect(`/exam-cell/mid-configuration?${params}`);
}
