"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { parseCSV, parseExcelWorkbook, readFileAsText } from "@/lib/utils/csv";
import { parsePastAttendanceGrid, type PastAttendanceGrid } from "@/lib/studentAttendance/pastImportGrid";
import { buildPastAttendanceTemplate } from "@/lib/studentAttendance/pastImportTemplate";

interface SectionOption { id: string; name: string; department: string; year: number }
interface DayReport {
  date: string; status: "READY" | "SKIPPED"; reason?: string; periods: number; created: number; alreadyPosted: number;
  skippedPeriods: string[]; detail: string[]; timetableNote?: string;
}
interface Result { days: DayReport[]; unmatchedRolls: string[]; rosterNotInFile: string[] }
interface SheetState { name: string; grid: PastAttendanceGrid; sectionId: string; result?: Result; applied?: boolean; runId?: string }

const DATES_PER_REQUEST = 7;
const STEPS = ["Upload file", "Match sections", "Preview", "Import"] as const;
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
// The template's own Sample and How to fill sheets (and similar) hold no real attendance and are never read.
const SKIPPED_SHEET = /^(sample|example|how|instruction|help|read ?me)/i;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const range = (g: PastAttendanceGrid) => (g.dates.length ? `${g.dates[0]} to ${g.dates[g.dates.length - 1]}` : "no dates");

function sheetStatus(s: SheetState): { label: string; variant: "approved" | "rejected" | "pending" | "in_progress" | "outline" } {
  if (s.grid.errors.length > 0) return { label: "Needs fixing", variant: "rejected" };
  if (s.applied) return { label: "Imported", variant: "approved" };
  if (!s.sectionId) return { label: "Choose a section", variant: "pending" };
  if (s.result) return { label: "Previewed", variant: "in_progress" };
  return { label: "Ready to preview", variant: "outline" };
}

// College Office > Import past student attendance. A workbook can hold one sheet per section (the college's
// attendance register does): each sheet is matched to a section, previewed, then imported. Each student's whole-day
// P/A becomes a submitted session for every timetable period of that day (see student-attendance/past-import).
export default function StudentAttendanceImportPage() {
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [focusId, setFocusId] = useState("");

  useEffect(() => {
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections?: SectionOption[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ title: "Could not load sections", variant: "destructive" }));
  }, []);

  // Moves keyboard / screen-reader focus to the heading of the step that just became current.
  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.focus();
  }, [focusId]);

  const patch = (i: number, p: Partial<SheetState>) => setSheets((all) => all.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const usedTwice = useMemo(() => {
    const seen = new Set<string>(); const dup = new Set<string>();
    for (const s of sheets) if (s.sectionId) (seen.has(s.sectionId) ? dup : seen).add(s.sectionId);
    return dup;
  }, [sheets]);
  const ready = sheets.filter((s) => s.sectionId && s.grid.errors.length === 0);
  const previewed = ready.length > 0 && ready.every((s) => s.result);
  const anyApplied = sheets.some((s) => s.applied);
  const stage = sheets.length === 0 ? 1 : anyApplied ? 4 : previewed ? 3 : 2;
  const toCreate = (s: SheetState) => s.result?.days.reduce((n, d) => n + d.created, 0) ?? 0;
  const totalCreate = sheets.reduce((n, s) => n + toCreate(s), 0);
  const totalPosted = sheets.reduce((n, s) => n + (s.result?.days.reduce((m, d) => m + d.alreadyPosted, 0) ?? 0), 0);
  const unmapped = sheets.filter((s) => s.grid.errors.length === 0 && !s.sectionId).length;
  const withErrors = sheets.filter((s) => s.grid.errors.length > 0).length;

  // Why the main button is off, in words (shown beside it, not only as a greyed-out button).
  const blocker =
    ready.length === 0 ? (withErrors > 0 ? "Fix the errors shown below, or choose another file." : "Choose a section for each sheet to continue.")
      : unmapped > 0 ? `${plural(unmapped, "sheet")} still need a section. Sheets without one are left out.`
        : usedTwice.size > 0 ? "Two sheets are matched to the same section - change one of them." : "";
  const canPreview = !busy && ready.length > 0 && usedTwice.size === 0;

  async function onFile(file: File | undefined) {
    setSheets([]);
    if (!file) return;
    setFileName(file.name);
    try {
      const year = new Date().getFullYear();
      const raw = file.name.toLowerCase().endsWith(".xlsx")
        ? await parseExcelWorkbook(file)
        : [{ name: file.name.replace(/\.[^.]+$/, ""), rows: parseCSV(await readFileAsText(file)) }];
      const usable = raw.filter((s) => !SKIPPED_SHEET.test(s.name.trim()));
      if (usable.length === 0) {
        toast({ title: "No attendance sheets found in this file", variant: "destructive" });
        return;
      }
      setSheets(usable.map((s) => {
        // Pre-select a section when exactly one section's name equals the sheet name (CSE-A -> CSE-A).
        const same = sections.filter((x) => norm(x.name) === norm(s.name));
        return { name: s.name, grid: parsePastAttendanceGrid(s.rows, year), sectionId: same.length === 1 ? same[0].id : "" };
      }));
      setFocusId("step-2-heading");
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not read the file", variant: "destructive" });
    }
  }

  function startOver() {
    setSheets([]); setFileName(""); setProgress(""); setFocusId("step-1-heading");
    const input = document.getElementById("attendance-file") as HTMLInputElement | null;
    if (input) input.value = "";
  }

  // Sends one sheet's dates in chunks and merges the day reports.
  async function runSheet(i: number, apply: boolean): Promise<void> {
    const sh = sheets[i];
    const runId = apply ? `pastimport-${Date.now()}-${i}` : undefined;
    const merged: Result = { days: [], unmatchedRolls: [], rosterNotInFile: [] };
    for (let from = 0; from < sh.grid.dates.length; from += DATES_PER_REQUEST) {
      const idxs = sh.grid.dates.map((_, k) => k).slice(from, from + DATES_PER_REQUEST);
      const res = await fetch("/api/college/student-attendance/past-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: sh.sectionId, apply, runId,
          dates: idxs.map((k) => sh.grid.dates[k]),
          students: sh.grid.students.map((s) => ({ roll: s.roll, marks: idxs.map((k) => s.marks[k]) })),
        }),
      });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(`${sh.name}: ${json.error ?? "Import failed"}`);
      merged.days.push(...json.days);
      merged.unmatchedRolls = json.unmatchedRolls;
      merged.rosterNotInFile = json.rosterNotInFile;
    }
    patch(i, { result: merged, applied: apply, ...(runId ? { runId } : {}) });
  }

  async function runAll(apply: boolean) {
    if (apply && !window.confirm(`Import ${plural(totalCreate, "period session")} for ${plural(ready.length, "sheet")}? You can undo it afterwards.`)) return;
    setBusy(apply ? "Importing" : "Checking");
    try {
      const todo = sheets.map((s, i) => ({ s, i })).filter(({ s }) => s.sectionId && s.grid.errors.length === 0);
      for (let k = 0; k < todo.length; k++) {
        setProgress(`${apply ? "Importing" : "Checking"} sheet ${k + 1} of ${todo.length}: ${todo[k].s.name}…`);
        await runSheet(todo[k].i, apply);
      }
      setProgress(apply ? "Import finished." : "Preview ready - review it below before importing.");
      setFocusId(apply ? "step-4-heading" : "step-3-heading");
    } catch (e) {
      setProgress("");
      toast({ title: e instanceof Error ? e.message : "Import failed", variant: "destructive" });
    } finally {
      setBusy("");
    }
  }

  async function undoAll() {
    if (!window.confirm("Remove every period session created by this import? Sessions edited since the import are kept.")) return;
    setBusy("Undoing");
    setProgress("Undoing the import…");
    try {
      let removed = 0;
      let kept = 0;
      for (const sh of sheets) {
        if (!sh.runId) continue;
        for (;;) {
          const res = await fetch("/api/college/student-attendance/past-import/rollback", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sh.runId }),
          });
          const json = (await res.json()) as { removed?: number; remaining?: number; editedSinceImport?: string[]; error?: string };
          if (!res.ok) throw new Error(json.error ?? "Undo failed");
          removed += json.removed ?? 0;
          kept += json.editedSinceImport?.length ?? 0;
          if (!json.remaining) break;
        }
      }
      setSheets((all) => all.map((s) => ({ ...s, result: undefined, applied: false, runId: undefined })));
      setProgress(`Removed ${plural(removed, "period session")}${kept ? `; ${plural(kept, "session")} edited since the import were kept` : ""}.`);
      setFocusId("step-2-heading");
    } catch (e) {
      setProgress("");
      toast({ title: e instanceof Error ? e.message : "Undo failed", variant: "destructive" });
    } finally {
      setBusy("");
    }
  }

  async function downloadTemplate() {
    setBusy("Building template");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await buildPastAttendanceTemplate(ExcelJS).xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "past_student_attendance_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Couldn't build the Excel template. Please try again.", variant: "destructive" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-6">
      <nav aria-label="Breadcrumb">
        <Link href="/college-office/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Students
        </Link>
      </nav>

      <PageHeader
        title="Import Past Student Attendance"
        description="Upload an attendance register. Each student's P or A for a day is applied to every period of that day in the section's timetable."
        actions={
          <Button variant="outline" onClick={() => void downloadTemplate()} disabled={!!busy} className="gap-2">
            <Download className="h-4 w-4" aria-hidden="true" /> Download template
          </Button>
        }
      />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Progress">
        {STEPS.map((label, k) => {
          const n = k + 1;
          const state = n < stage ? "done" : n === stage ? "current" : "todo";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                state === "current" && "border-primary bg-primary/5 font-medium",
                state === "todo" && "text-muted-foreground",
              )}
            >
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs", state === "done" && "border-green-600 bg-green-600 text-white", state === "current" && "border-primary bg-primary text-primary-foreground")}>
                {state === "done" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : n}
              </span>
              <span>{label}<span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : ""}</span></span>
            </li>
          );
        })}
      </ol>

      <div role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{progress}</div>

      <section aria-labelledby="step-1-heading" className="space-y-2">
        <h2 id="step-1-heading" tabIndex={-1} className="text-lg font-semibold focus:outline-none">1. Upload the register</h2>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="attendance-file">Attendance file (.xlsx with one sheet per section, or .csv for one section)</Label>
            <input
              id="attendance-file"
              type="file"
              accept=".xlsx,.csv"
              aria-describedby="attendance-file-help"
              disabled={!!busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full cursor-pointer text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <ul id="attendance-file-help" className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>A Regd. No column (kept as text) and one column per date. Write dates in full, like 11-8-2026.</li>
            <li>Cells: <strong>P</strong> or <strong>A</strong>. Leave blank when there is no record.</li>
            <li>Sundays, holidays and days with no timetable are skipped. A period that already has attendance is never changed.</li>
          </ul>
          {fileName && (
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span><strong>{fileName}</strong> - {plural(sheets.length, "sheet")} found</span>
              <Button variant="ghost" size="sm" onClick={startOver} disabled={!!busy} className="ml-auto gap-1">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Choose another file
              </Button>
            </p>
          )}
        </CardContent>
      </Card>
      </section>

      {sheets.length > 0 && (
        <section aria-labelledby="step-2-heading" className="space-y-4">
          <h2 id="step-2-heading" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            2. Match each sheet to a section
          </h2>

          {sheets.map((sh, i) => {
            const status = sheetStatus(sh);
            const selectId = `section-${i}`;
            return (
              <Card key={`${sh.name}-${i}`}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">Sheet &quot;{sh.name}&quot;</h3>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {plural(sh.grid.students.length, "student")} · {plural(sh.grid.dates.length, "date")} ({range(sh.grid)})
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor={selectId}>Section for this sheet</Label>
                    <select
                      id={selectId}
                      className="w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      value={sh.sectionId}
                      disabled={!!busy || sh.applied}
                      aria-invalid={!!sh.sectionId && usedTwice.has(sh.sectionId)}
                      aria-describedby={sh.sectionId && usedTwice.has(sh.sectionId) ? `${selectId}-error` : undefined}
                      onChange={(e) => patch(i, { sectionId: e.target.value, result: undefined })}
                    >
                      <option value="">Select a section…</option>
                      {sections.map((s) => <option key={s.id} value={s.id}>{s.department} - Year {s.year} - {s.name}</option>)}
                    </select>
                    {sh.sectionId && usedTwice.has(sh.sectionId) && (
                      <p id={`${selectId}-error`} className="text-sm text-destructive">Another sheet is matched to this same section.</p>
                    )}
                  </div>

                  {sh.grid.errors.length > 0 && (
                    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <p className="font-medium">This sheet can&apos;t be imported until these are fixed in the file:</p>
                      <ul className="mt-1 list-disc pl-5">
                        {sh.grid.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
                        {sh.grid.errors.length > 8 && <li>…and {sh.grid.errors.length - 8} more</li>}
                      </ul>
                    </div>
                  )}

                  {sh.grid.warnings.length > 0 && (
                    <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <summary className="cursor-pointer font-medium">
                        <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />
                        {plural(sh.grid.warnings.length, "warning")} - the register&apos;s own totals differ from its P/A marks (the marks are what is imported)
                      </summary>
                      <ul className="mt-2 list-disc pl-5">{sh.grid.warnings.slice(0, 30).map((w) => <li key={w}>{w}</li>)}</ul>
                    </details>
                  )}

                  {sh.result && <SheetResult sheet={sh} />}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {stage >= 3 && (
        <section aria-labelledby="step-3-heading" className="rounded-lg border p-4">
          <h2 id="step-3-heading" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {anyApplied ? "3. Preview (done)" : "3. Review the preview"}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={anyApplied ? "Period sessions created" : "Period sessions to create"} value={totalCreate} />
            <Stat label="Already had attendance (left as is)" value={totalPosted} />
            <Stat label="Sheets" value={ready.length} />
            <Stat label="Skipped days" value={sheets.reduce((n, s) => n + (s.result?.days.filter((d) => d.status === "SKIPPED").length ?? 0), 0)} />
          </dl>
        </section>
      )}

      {stage === 4 && (
        <section aria-labelledby="step-4-heading" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
          <h2 id="step-4-heading" tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold focus:outline-none">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> 4. Import finished
          </h2>
          <p className="mt-1 text-sm">
            {plural(totalCreate, "period session")} created. Check a day in the attendance reports; if anything looks wrong, use Undo this import.
          </p>
          <Link href="/college-office/attendance-reports" className="mt-2 inline-block text-sm font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Open attendance reports
          </Link>
        </section>
      )}

      {sheets.length > 0 && (
        <div className="sticky bottom-0 z-20 border-t bg-background shadow-[0_-4px_8px_-6px_rgba(0,0,0,0.15)]">
          <div className="flex flex-wrap items-center gap-3 py-3">
            {stage === 2 && (
              <>
                <Button onClick={() => void runAll(false)} disabled={!canPreview} loading={busy === "Checking"}>
                  {busy === "Checking" ? "Checking…" : "Preview"}
                </Button>
                {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}
              </>
            )}
            {stage === 3 && (
              <>
                <Button onClick={() => void runAll(true)} disabled={!!busy || totalCreate === 0} loading={busy === "Importing"}>
                  {busy === "Importing" ? "Importing…" : `Import ${plural(totalCreate, "period session")}`}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {totalCreate === 0 ? "Nothing to create - every day was skipped or already has attendance." : "Nothing is saved until you import. You can undo it afterwards."}
                </p>
              </>
            )}
            {stage === 4 && (
              <>
                <Button variant="outline" onClick={() => void undoAll()} disabled={!!busy} loading={busy === "Undoing"} className="gap-2">
                  <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo this import
                </Button>
                <Button variant="ghost" onClick={startOver} disabled={!!busy}>Import another file</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

// One sheet's preview / result: notes first (what to look at), the day-by-day table folded away until asked for.
function SheetResult({ sheet }: { sheet: SheetState }) {
  const r = sheet.result!;
  const notes = r.days.filter((d) => d.timetableNote);
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm">
        {plural(r.days.filter((d) => d.status === "READY").length, "day")} {sheet.applied ? "imported" : "ready"} ·{" "}
        {plural(r.days.reduce((n, d) => n + d.created, 0), "period session")} {sheet.applied ? "created" : "to create"} ·{" "}
        {r.days.reduce((n, d) => n + d.alreadyPosted, 0)} already had attendance
      </p>

      {notes.length > 0 && (
        <Note>
          {notes.length} of these {notes.length === 1 ? "day is" : "days are"} dated before the current timetable took effect. Every day is saved against the
          current timetable, so the subject and faculty shown follow it - overall attendance is not affected.
        </Note>
      )}
      {r.unmatchedRolls.length > 0 && <Note tone="error">Regd. Nos not in this section (ignored): {r.unmatchedRolls.join(", ")}</Note>}
      {r.rosterNotInFile.length > 0 && <Note>In the section but not in the sheet (no record): {r.rosterNotInFile.join(", ")}</Note>}

      <details>
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Day by day ({r.days.length})</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Day-by-day result for sheet {sheet.name}</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="p-2">Date</th>
                <th scope="col" className="p-2">Result</th>
                <th scope="col" className="p-2 text-right">Periods</th>
                <th scope="col" className="p-2 text-right">{sheet.applied ? "Created" : "To create"}</th>
                <th scope="col" className="p-2 text-right">Already posted</th>
              </tr>
            </thead>
            <tbody>
              {r.days.map((d) => (
                <tr key={d.date} className="border-b align-top">
                  <th scope="row" className="whitespace-nowrap p-2 text-left font-normal tabular-nums">{d.date}</th>
                  <td className="p-2">
                    {d.status === "SKIPPED" ? <Badge variant="pending">Skipped</Badge> : d.skippedPeriods.length ? <Badge variant="modified">Partly</Badge> : <Badge variant="approved">OK</Badge>}
                    {d.reason && <span className="ml-2 text-muted-foreground">{d.reason}</span>}
                    {d.skippedPeriods.length > 0 && <div className="mt-1 text-xs text-muted-foreground">{d.skippedPeriods.join("; ")}</div>}
                    {d.timetableNote && <div className="mt-1 text-xs text-amber-700">{d.timetableNote}</div>}
                    {d.detail.length > 0 && <ul className="mt-1 text-xs text-muted-foreground">{d.detail.map((x) => <li key={x}>{x}</li>)}</ul>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{d.periods}</td>
                  <td className="p-2 text-right tabular-nums">{d.created}</td>
                  <td className="p-2 text-right tabular-nums">{d.alreadyPosted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Note({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "error" }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-md border p-2 text-sm", tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800")}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
