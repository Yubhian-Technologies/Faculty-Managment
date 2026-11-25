"use client";

import { useRef, useState } from "react";
import { CheckCircle2, ChevronDown, FileSpreadsheet, FolderOpen, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// Exam Cell > Mid Marks > Upload Mid Files (Mid exam format colleges): the Exam Cell picks the Mid marks workbooks
// (or a whole folder of them) - one per subject per section, a sheet per component (Descriptive, Quiz, Course
// Activity ...). Check reads every file against the format and the section's students and writes nothing; Save
// saves the files without problems (submitted, entered by the Exam Cell). Students see the marks once frozen.

type Cell = string | number | null;
interface Workbook { fileName: string; sheets: { name: string; rows: Cell[][] }[] }
interface Result {
  fileName: string; subjectCode: string; subjectName?: string; section?: string; department?: string; sheetId?: string;
  students: number; absent: number; notInFile: number; coPending: number; errors: string[]; notes: string[]; saved?: boolean;
}

const CHUNK = 5;

function plain(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return plain(o.result);
    if (typeof o.text === "string") return o.text;
    if (o.error) return String(o.error);
  }
  return String(v);
}

async function readWorkbook(file: File): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return {
    fileName: file.name,
    sheets: wb.worksheets.map((ws) => {
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = (row.values as unknown[]).slice(1).map(plain); });
      return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
    }),
  };
}

export function MidFilesUploadDialog({ planId, title, onClose, onChanged }: { planId: string; title: string; onClose: () => void; onChanged: () => void }) {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<Workbook[]>([]);
  const [unread, setUnread] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<null | "read" | "check" | "save">(null);
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  async function pick(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => /\.xlsx$/i.test(f.name) && !f.name.startsWith("~$"));
    if (!files.length) { toast({ variant: "destructive", title: "Select .xlsx files, or a folder that has them." }); return; }
    setBusy("read"); setResults(null);
    const ok: Workbook[] = [];
    const bad: string[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(`Reading ${i + 1} of ${files.length}`);
      try { ok.push(await readWorkbook(f)); } catch { bad.push(f.name); }
    }
    ok.sort((a, b) => a.fileName.localeCompare(b.fileName));
    setBooks(ok); setUnread(bad); setBusy(null); setProgress("");
  }

  async function send(list: Workbook[], apply: boolean): Promise<Result[]> {
    const out: Result[] = [];
    for (let i = 0; i < list.length; i += CHUNK) {
      setProgress(`${apply ? "Saving" : "Checking"} ${Math.min(i + CHUNK, list.length)} of ${list.length}`);
      const res = await fetch("/api/college/mid-marks-sheets/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, apply, files: list.slice(i, i + CHUNK) }),
      });
      const d = (await res.json()) as { results?: Result[]; error?: string };
      if (!res.ok || !d.results) throw new Error(d.error ?? "Unable to check the files.");
      out.push(...d.results);
    }
    return out;
  }

  async function check() {
    setBusy("check");
    try { setResults(await send(books, false)); } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(null); setProgress(""); }
  }

  const good = results?.filter((r) => !r.errors.length) ?? [];
  async function save() {
    const names = new Set(good.map((r) => r.fileName));
    setBusy("save");
    try {
      const saved = await send(books.filter((b) => names.has(b.fileName)), true);
      const byName = new Map(saved.map((r) => [r.fileName, r]));
      setResults((cur) => (cur ?? []).map((r) => byName.get(r.fileName) ?? r));
      const n = saved.filter((r) => r.saved).length;
      toast({ variant: n === saved.length ? "success" : "default", title: `${n} of ${saved.length} file${saved.length === 1 ? "" : "s"} saved. Check the marks and freeze them so students can see them.` });
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusy(null); setProgress("");
    }
  }

  const savedCount = results?.filter((r) => r.saved).length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Mid Files</DialogTitle>
          <DialogDescription>
            {title}. One workbook per subject per section, with a sheet for each part of the Mid exam format (Descriptive, Quiz, Course Activity ...).
            Each file is checked against the format and the section&apos;s students; totals must match the file&apos;s Total columns.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={filesRef} type="file" accept=".xlsx" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
          <input ref={folderRef} type="file" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = ""; }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          <Button variant="outline" disabled={!!busy} onClick={() => filesRef.current?.click()}><FileSpreadsheet className="mr-1 h-4 w-4" />Choose Files</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => folderRef.current?.click()}><FolderOpen className="mr-1 h-4 w-4" />Choose Folder</Button>
          {books.length > 0 && <span className="text-sm text-muted-foreground">{books.length} file{books.length === 1 ? "" : "s"} read{unread.length ? `, ${unread.length} could not be read (${unread.slice(0, 3).join(", ")})` : ""}.</span>}
          {progress && <span className="text-sm text-muted-foreground">{progress}…</span>}
        </div>

        {results && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border px-2.5 py-1"><b>{good.length}</b> ready</span>
              <span className={cn("rounded-full border px-2.5 py-1", results.length - good.length && "border-destructive/50 text-destructive")}><b>{results.length - good.length}</b> with problems</span>
              {savedCount > 0 && <span className="rounded-full border border-emerald-400 px-2.5 py-1 text-emerald-700 dark:text-emerald-300"><b>{savedCount}</b> saved</span>}
              <span className="rounded-full border px-2.5 py-1"><b>{results.reduce((n, r) => n + r.students, 0)}</b> students</span>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">File</th><th className="px-3 py-2 font-medium">Subject</th><th className="px-3 py-2 font-medium">Section</th><th className="px-3 py-2 text-right font-medium">Students</th><th className="px-3 py-2 text-right font-medium">Absent</th><th className="px-3 py-2 font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y">
                  {results.map((r) => {
                    const expand = open === r.fileName;
                    const detail = r.errors.length + r.notes.length > 0;
                    return (
                      <tr key={r.fileName} className="align-top">
                        <td className="px-3 py-2 text-xs">{r.fileName}</td>
                        <td className="px-3 py-2"><span className="font-medium">{r.subjectCode}</span>{r.subjectName && <span className="block max-w-[200px] truncate text-xs text-muted-foreground">{r.subjectName}</span>}</td>
                        <td className="px-3 py-2 text-xs">{r.section ? `${r.department} · ${r.section}` : "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.students || "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.absent || "-"}</td>
                        <td className="px-3 py-2">
                          <button type="button" disabled={!detail} onClick={() => setOpen(expand ? null : r.fileName)} className="flex items-center gap-1 text-left text-xs font-medium">
                            {r.saved ? <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span>
                              : r.errors.length ? <span className="flex items-center gap-1 text-destructive"><TriangleAlert className="h-3.5 w-3.5" />{r.errors.length} problem{r.errors.length === 1 ? "" : "s"}</span>
                              : <span className="text-emerald-700 dark:text-emerald-300">Ready</span>}
                            {r.coPending > 0 && !r.errors.length && <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">CO pending</span>}
                            {detail && <ChevronDown className={cn("h-3.5 w-3.5 transition", expand && "rotate-180")} />}
                          </button>
                          {expand && (
                            <ul className="mt-1.5 max-w-md space-y-0.5 text-xs">
                              {r.errors.map((e, i) => <li key={`e${i}`} className="text-destructive">{e}</li>)}
                              {r.notes.map((n, i) => <li key={`n${i}`} className="text-muted-foreground">{n}</li>)}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={onClose}>Close</Button>
          {(!results || savedCount === 0) && <Button variant={results ? "outline" : "default"} disabled={!books.length || !!busy} loading={busy === "check"} onClick={() => void check()}>Check Files</Button>}
          {results && savedCount === 0 && <Button disabled={!good.length || !!busy} loading={busy === "save"} onClick={() => void save()}>Save {good.length} File{good.length === 1 ? "" : "s"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
