"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { MidMarksSheetView, type EntryState } from "@/components/midMarks/MidMarksSheetView";
import { MidQuestionsEditor } from "@/components/midMarks/MidQuestionsEditor";
import type { MidMarksSheet, MidSheetCie } from "@/types/midMarks";

// Exam Cell > Mid Marks > a section's sheet entered on Faculty > Mid Marks (or uploaded by the Exam Cell): read only,
// Freeze / Reopen once submitted; Mid exam format sheets: Questions & COs.
export default function ExamCellMidMarksSheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = use(params);
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["mid-marks-sheet-review", sheetId],
    queryFn: async () => {
      const res = await fetch(`/api/college/mid-marks-sheets/${sheetId}`);
      const d = (await res.json()) as { sheet?: MidMarksSheet; state?: EntryState | null; cie?: MidSheetCie | null; error?: string };
      if (!res.ok || !d.sheet) throw new Error(d.error ?? "Unable to open the sheet.");
      return d;
    },
  });
  return (
    <div className="space-y-4">
      <Link href="/exam-cell/mid-marks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Mid Marks</Link>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data?.sheet && (
        // Remounted on every new version (after Questions & COs), so the view shows the saved sheet.
        <MidMarksSheetView key={q.data.sheet.rev} initial={q.data.sheet} state={q.data.state ?? null} mode="review" cie={q.data.cie ?? null} examCell
          onEditQuestions={q.data.sheet.format ? () => setEditing(true) : undefined} />
      )}
      {editing && q.data?.sheet && (
        <MidQuestionsEditor assignmentId={q.data.sheet.assignmentId} midNumber={q.data.sheet.midNumber} onClose={() => setEditing(false)} onSaved={() => void q.refetch()} />
      )}
    </div>
  );
}
