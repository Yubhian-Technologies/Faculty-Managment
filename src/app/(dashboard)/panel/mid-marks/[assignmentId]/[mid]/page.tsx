"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MidMarksSheetView, type EntryState } from "@/components/midMarks/MidMarksSheetView";
import type { MidMarksSheet, MidSheetCie } from "@/types/midMarks";

// Faculty > Mid Marks > one section's sheet (opened / created on load).
export default function MidMarksSheetPage({ params }: { params: Promise<{ assignmentId: string; mid: string }> }) {
  const { assignmentId, mid } = use(params);
  const q = useQuery({
    queryKey: ["mid-marks-sheet", assignmentId, mid],
    queryFn: async () => {
      const res = await fetch("/api/college/mid-marks-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, midNumber: Number(mid) }) });
      const d = (await res.json()) as { sheet?: MidMarksSheet | null; state?: EntryState; cie?: MidSheetCie | null; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to open the sheet.");
      return d;
    },
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-4">
      <Link href="/panel/mid-marks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Mid Marks</Link>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && !q.data.sheet && <Card className="p-6 text-sm">{q.data.state?.reason || "This sheet is not open for entry yet."}</Card>}
      {q.data?.sheet && <MidMarksSheetView initial={q.data.sheet} state={q.data.state ?? null} mode="faculty" cie={q.data.cie ?? null} />}
    </div>
  );
}
