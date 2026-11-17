"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Lock, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { MidMarksLayout } from "@/lib/exams/midMarksEntry";
import { FIXED_HEADERS, layoutFromUpload, parseUploadSheet, type RowCheck, type UploadRow } from "@/lib/exams/midMarksUploadRows";

// Exam Cell mode: download the marks sheet of a subject + branch (all its sections), fill the questions' max marks
// and every student's marks, upload -> each row checked (nothing saved) -> Save Marks -> Submit All Sections.

interface SectionState {
  name: string; faculty: string; status: string; locked: boolean; entered: number; total?: number;
  students: { roll: string; name: string; absent: boolean; values: Record<string, number | null> }[];
}
interface Preview {
  layout: MidMarksLayout; checks: RowCheck[]; notInFile: { roll: string; name: string; section: string }[];
  applied?: { section: string; students: number }[]; skipped?: { section: string; reason: string }[];
}

export function MidMarksUploadDialog({ planId, midNumber, subjectId, subjectCode, subjectName, branch, onClose, onChanged }: {
  planId: string; midNumber: number; subjectId: string; subjectCode: string; subjectName: string; branch: string;
  onClose: () => void; onChanged: () => void;
}) {
  const [sheet, setSheet] = useState<{ layout: MidMarksLayout | null; sections: SectionState[] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState<{ layout: MidMarksLayout; rows: UploadRow[]; fileName: string } | null>(null);
  const [busy, setBusy] = useState<"read" | "apply" | "submit" | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ planId, subjectId, branch });
    return fetch(`/api/college/mid-marks/sheet?${q}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the sections."); return d; })
      .then((d: { layout: MidMarksLayout | null; sections: SectionState[] }) => setSheet({ layout: d.layout, sections: d.sections }))
      .catch((e: Error) => toast({ variant: "destructive", title: e.message }));
  }, [planId, subjectId, branch]);
  useEffect(() => { void load(); }, [load]);

  async function downloadTemplate() {
    if (!sheet) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Mid-${midNumber}`);
    const layout = sheet.layout ?? { questions: [1, 2, 3, 4, 5].map((n) => ({ label: `Q${n}`, max: 0 })), paperMax: 0 };
    const labels = layout.questions.map((q) => q.label);
    ws.addRow([...FIXED_HEADERS, ...labels]).font = { bold: true };
    ws.addRow(["Max Marks", "", "", "", ...layout.questions.map((q) => (q.max || ""))]).font = { bold: true, color: { argb: "FF1D4ED8" } };
    ws.addRow(["Paper Max", layout.paperMax || ""]).font = { bold: true, color: { argb: "FF1D4ED8" } };
    for (const s of sheet.sections) {
      for (const st of s.students) {
        ws.addRow([st.roll, st.name, s.name, st.absent ? "AB" : "", ...layout.questions.map((_, i) => st.values[`L${i + 1}`] ?? "")]);
      }
    }
    ws.columns = [{ width: 16 }, { width: 30 }, { width: 10 }, { width: 9 }, ...labels.map(() => ({ width: 8 }))];
    ws.views = [{ state: "frozen", ySplit: 3, xSplit: 2 }];
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `MID${midNumber}_${subjectCode}_${branch}_marks.xlsx`.replace(/[\\/:*?"<>|\s]+/g, "-");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function send(layout: MidMarksLayout, rows: UploadRow[], apply: boolean): Promise<Preview | null> {
    const res = await fetch("/api/college/mid-marks/upload", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, subjectId, branch, apply, layout, rows }),
    });
    const d = await res.json();
    if (!res.ok) { toast({ variant: "destructive", title: d.error ?? "Unable to read the marks." }); return null; }
    return d as Preview;
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy("read"); setPreview(null); setPending(null);
    try {
      if (!f.name.toLowerCase().endsWith(".xlsx")) throw new Error("Upload the .xlsx template (Excel), filled in.");
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("The file has no sheet.");
      const cells: unknown[][] = [];
      ws.eachRow({ includeEmpty: true }, (row) => { cells.push((row.values as unknown[]).slice(1)); });
      const parsed = parseUploadSheet(cells);
      if ("error" in parsed) throw new Error(parsed.error);
      const lay = layoutFromUpload(parsed);
      if ("error" in lay) throw new Error(lay.error);
      const p = await send(lay.layout, parsed.rows, false);
      if (p) { setPreview(p); setPending({ layout: lay.layout, rows: parsed.rows, fileName: f.name }); }
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to read the file." });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy("apply");
    try {
      const p = await send(pending.layout, pending.rows, true);
      if (!p) return;
      setPreview(p);
      setPending(null);
      toast({ title: `Marks saved for ${p.applied?.reduce((n, a) => n + a.students, 0) ?? 0} students.` });
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function submitAll() {
    setBusy("submit");
    try {
      const res = await fetch("/api/college/mid-marks/submit", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, subjectId, branch }),
      });
      const d = (await res.json()) as { error?: string; submitted?: string[]; incomplete?: { section: string; missing: number }[] };
      if (!res.ok) throw new Error(d.error ?? "Unable to submit.");
      const open = d.incomplete ?? [];
      toast(open.length
        ? { variant: "destructive", title: `Submitted ${d.submitted?.length ?? 0} section(s). Not submitted: ${open.map((x) => `${x.section}${x.missing > 0 ? ` (${x.missing} without marks)` : " (no marks yet)"}`).join(", ")}.` }
        : { title: "Mid marks submitted for every section." });
      await load();
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const errors = preview?.checks.filter((c) => c.error) ?? [];
  const okRows = (preview?.checks.length ?? 0) - errors.length;
  const allLocked = !!sheet && sheet.sections.length > 0 && sheet.sections.every((s) => s.locked);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mid-{midNumber} Marks · {subjectCode}</DialogTitle>
          <DialogDescription>{subjectName} · {branch}. Download the sheet, enter each question&apos;s max marks and every student&apos;s marks, then upload it.</DialogDescription>
        </DialogHeader>

        {!sheet ? <div className="h-24 animate-pulse rounded-lg border bg-muted/30" /> : (
          <div className="space-y-4">
            <div className="rounded-lg border divide-y text-sm">
              {sheet.sections.map((s) => (
                <div key={s.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium">Section {s.name}</span>
                  <span className="text-muted-foreground">{s.faculty}</span>
                  <span className="ml-auto text-muted-foreground">{s.entered} of {s.total ?? s.students.length} entered</span>
                  {s.locked ? <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Submitted</Badge>
                    : s.status === "SUBMITTED" ? <Badge variant="outline">Faculty submitted</Badge> : null}
                </div>
              ))}
            </div>
            {sheet.layout && (
              <p className="text-xs text-muted-foreground">
                Questions: {sheet.layout.questions.map((q) => `${q.label} (${q.max})`).join(", ")} · Paper Max {sheet.layout.paperMax}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void downloadTemplate()}><Download className="mr-1.5 h-4 w-4" />Download Sheet</Button>
              <Button asChild variant="outline" disabled={busy !== null || allLocked}>
                <label className="cursor-pointer">
                  <Upload className="mr-1.5 h-4 w-4" />{busy === "read" ? "Reading…" : "Upload Filled Sheet"}
                  <input type="file" accept=".xlsx" className="hidden" disabled={busy !== null || allLocked} onChange={(e) => void pick(e)} />
                </label>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Fill the &quot;Max Marks&quot; row under each question (rename or add question columns as needed) and the &quot;Paper Max&quot;
              (less than the questions added up when students choose). Absent: write AB in the Absent column and leave the marks blank.
            </p>

            {preview && (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                {preview.applied ? (
                  <p className="font-medium text-emerald-700">
                    Saved: {preview.applied.map((a) => `Section ${a.section} (${a.students})`).join(", ") || "nothing"}.
                  </p>
                ) : (
                  <p><span className="font-medium">{okRows}</span> rows ready{errors.length ? <>, <span className="font-medium text-destructive">{errors.length} with problems</span></> : ""}. Nothing is saved yet.</p>
                )}
                {preview.skipped?.map((s) => <p key={s.section} className="text-amber-700">Section {s.section} not saved: {s.reason}</p>)}
                {errors.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto text-xs text-destructive">
                    {errors.map((x) => <li key={x.rowNo}>Row {x.rowNo} ({x.roll || "no Regd. No"}): {x.error}</li>)}
                  </ul>
                )}
                {preview.notInFile.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Not in the file ({preview.notInFile.length}, left as they are): {preview.notInFile.slice(0, 8).map((x) => x.roll).join(", ")}{preview.notInFile.length > 8 ? " …" : ""}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => void submitAll()} loading={busy === "submit"} disabled={busy !== null || !sheet || allLocked}>
            <Lock className="mr-1.5 h-4 w-4" />Submit All Sections
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {pending && (
              <Button onClick={() => void apply()} loading={busy === "apply"} disabled={busy !== null || errors.length > 0}>Save Marks</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
