"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { dmy } from "@/lib/utils";
import { midOf } from "@/lib/cea/rules";
import type { CeaWhen } from "@/types";

// CIE marks for a whole section at once (faculty > CIE Marks, Exam Cell > CIE > Marks by section): download the
// template (every planned unit, the section's students, marks so far), fill one total per student per unit (or AB),
// upload. The upload is checked first and saves nothing while any problem remains; saved units stay drafts for the
// faculty member to check and Submit (POST /api/college/cea/marks/upload).

type Info = {
  subjectCode: string; subjectName: string; department: string; section: string; unitMarks: number;
  units: { unit: number; title: string; when: CeaWhen; status: "DRAFT" | "SUBMITTED" | null; heldOn: string | null }[];
  students: { rollNumber: string; name: string; marks: Record<string, string | number> }[];
};
type Check = { ok: boolean; problems: string[]; units: { unit: number; marks: number }[]; skippedSubmitted: number[]; marksGiven: number };

const unitHeader = (u: Info["units"][number], max: number) => `Unit ${u.unit} (/${max})${midOf(u.when) ? ` - with Mid ${midOf(u.when)}` : ""}`;
const DATE_ROW = "Date Held (DD/MM/YYYY)";

export function CeaUploadPanel({ assignmentId, onSaved }: { assignmentId: string; onSaved?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState<{ rows: { roll: string; marks: Record<string, string> }[]; heldOn: Record<string, string>; check: Check; fileName: string } | null>(null);

  async function info(): Promise<Info> {
    const r = await fetch(`/api/college/cea/marks/upload?assignmentId=${encodeURIComponent(assignmentId)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Unable to load the section");
    return j as Info;
  }

  async function download() {
    setBusy("download");
    try {
      const d = await info();
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("CIE Marks");
      ws.addRow(["Regd. No", "Name", ...d.units.map((u) => unitHeader(u, d.unitMarks))]);
      ws.addRow([DATE_ROW, "", ...d.units.map((u) => (midOf(u.when) ? "With Mid" : u.heldOn ? dmy(u.heldOn) : ""))]);
      for (const s of d.students) ws.addRow([s.rollNumber, s.name, ...d.units.map((u) => s.marks[String(u.unit)] ?? "")]);
      ws.getRow(1).font = { bold: true };
      ws.getRow(2).font = { italic: true };
      ws.getColumn(1).width = 18; ws.getColumn(2).width = 32;
      d.units.forEach((u, i) => { ws.getColumn(i + 3).width = 22; if (u.status === "SUBMITTED") ws.getCell(1, i + 3).note = "Submitted - reopen it to change these marks"; });
      ws.getColumn(1).numFmt = "@";
      ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `CIE-${d.subjectCode}-${d.section}.xlsx`.replace(/[^A-Za-z0-9.-]+/g, "_"); a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to download the template" });
    } finally { setBusy(""); }
  }

  async function post(rows: { roll: string; marks: Record<string, string> }[], heldOn: Record<string, string>, apply: boolean): Promise<Check> {
    const r = await fetch("/api/college/cea/marks/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, rows, heldOn, apply }),
    });
    const j = await r.json();
    if (!r.ok && !Array.isArray(j.problems)) throw new Error(j.error ?? "Unable to upload");
    return j as Check;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy("check");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("The file has no sheet");
      const text = (v: unknown): string => {
        if (v == null) return "";
        if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
        if (typeof v === "object") { const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }; return o.richText ? o.richText.map((x) => x.text).join("") : String(o.text ?? o.result ?? ""); }
        return String(v);
      };
      const header = (ws.getRow(1).values as unknown[]).map(text);
      const rollCol = header.findIndex((h) => /regd|roll|reg\.?\s*no/i.test(h));
      const unitCols = header.map((h, i) => ({ i, m: /^\s*unit\s*(\d+)/i.exec(h) })).filter((x) => x.m).map((x) => ({ col: x.i, unit: x.m![1] }));
      if (rollCol < 0 || unitCols.length === 0) throw new Error("Use the downloaded template - it needs a Regd. No column and Unit columns");
      const rows: { roll: string; marks: Record<string, string> }[] = [];
      const heldOn: Record<string, string> = {};
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const vals = row.values as unknown[];
        const first = text(vals[rollCol]).trim();
        if (/^date held/i.test(first)) { for (const u of unitCols) heldOn[u.unit] = text(vals[u.col]).trim(); return; }
        if (!first) return;
        rows.push({ roll: first, marks: Object.fromEntries(unitCols.map((u) => [u.unit, text(vals[u.col]).trim()])) });
      });
      for (const k of Object.keys(heldOn)) if (/^with mid/i.test(heldOn[k])) delete heldOn[k];
      setPending({ rows, heldOn, check: await post(rows, heldOn, false), fileName: file.name });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to read the file" });
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy("apply");
    try {
      const res = await post(pending.rows, pending.heldOn, true);
      if (!res.ok) { setPending({ ...pending, check: res }); return; }
      toast({ variant: "success", title: `Marks saved as drafts for ${res.units.length} unit${res.units.length === 1 ? "" : "s"}.`, description: "Check them and press Submit for each unit." });
      setPending(null);
      onSaved?.();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to upload" });
    } finally { setBusy(""); }
  }

  const c = pending?.check;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void download()} loading={busy === "download"}><Download className="mr-1.5 h-4 w-4" />Download Template</Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} loading={busy === "check"}><Upload className="mr-1.5 h-4 w-4" />Upload Marks</Button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload CIE Marks</DialogTitle>
            <DialogDescription>{pending?.fileName}</DialogDescription>
          </DialogHeader>
          {c && (c.problems.length > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-destructive">Nothing was saved. Fix these in the file and upload it again:</p>
              <ul className="list-disc space-y-1 pl-5 text-destructive">{c.problems.slice(0, 40).map((p, i) => <li key={i}>{p}</li>)}</ul>
              {c.problems.length > 40 && <p className="text-xs text-muted-foreground">and {c.problems.length - 40} more</p>}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>{c.marksGiven} mark{c.marksGiven === 1 ? "" : "s"} ready to save as drafts:</p>
              <ul className="list-disc space-y-0.5 pl-5">{c.units.map((u) => <li key={u.unit}>Unit {u.unit}: {u.marks} student{u.marks === 1 ? "" : "s"}</li>)}</ul>
              {c.skippedSubmitted.length > 0 && <p className="text-amber-700">Unit {c.skippedSubmitted.join(", ")} already submitted - left as they are (reopen to change).</p>}
              <p className="text-xs text-muted-foreground">Blank cells leave marks as they are. After saving, check each unit and press Submit.</p>
            </div>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{c?.problems.length ? "Close" : "Cancel"}</Button>
            {c && c.problems.length === 0 && c.units.length > 0 && <Button onClick={() => void apply()} loading={busy === "apply"}>Save as Drafts</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
