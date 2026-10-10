"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, Search } from "lucide-react";
import {
  parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText, matchHeaders, toCSV, downloadCSV,
} from "@/lib/utils/csv";
import { ROSTER_FIELDS } from "@/lib/students/rosterFields";
import {
  BULK_UPDATE_GROUPS, bulkFieldLabel, isBulkUpdateField,
  type BulkUpdateOutcome, type BulkUpdateResult, type BulkUpdateRow,
} from "@/lib/students/bulkUpdate";
import { MAX_BULK_APPLY_ROWS, MAX_BULK_UPDATE_ROWS } from "@/lib/students/bulkUpdateRows";

// Updates DETAIL fields on students already on the roster, matched on Student Mobile No - the same key the "Map roll
// numbers" tab uses, and a sibling of it: Roll No is deliberately NOT a choice here.
//
// The Office picks the fields -> downloads a template with Student Mobile No + those columns -> uploads it -> checks
// the preview (every Fill / Overwrite shown as old -> new) -> applies. A blank cell never changes anything; a value
// equal to what is stored is left alone; a different value overwrites it (unless "fill blanks only" is ticked). Every
// changed value's old and new text is saved with the run, and downloadable.

const MOBILE_HEADER = "Student Mobile No";
const MOBILE_ALIASES = ["Mobile No", "Mobile", "Phone", "Student Mobile", "Mobile Number"];
// Header matching runs against EVERY roster column so a file with Roll No / Name / Course gets a pointed message instead of
// "unknown column".
const COLUMNS = ROSTER_FIELDS.map((f) => ({ key: f.key, label: f.label, aliases: f.key === "mobileNo" ? MOBILE_ALIASES : f.aliases }));
const FIELD_BY_KEY = new Map(ROSTER_FIELDS.map((f) => [f.key, f]));

const HINTS = [
  "Student Mobile No is how each row finds its student - it must be the number already on their record. It is never changed here.",
  "Only the columns you pick are in the template. A blank cell never changes or clears anything.",
  "If the student already has the same value it is left alone. If it is different, it is overwritten - the preview shows old -> new first.",
  "The old value of everything changed is saved with the run and can be downloaded after applying.",
  "Roll No is not part of this - use the Map roll numbers tab for that.",
  "Nothing is written until you press Apply.",
];

const OUTCOME_LABELS: { key: BulkUpdateOutcome; label: string; tone: "good" | "warn" | "bad" }[] = [
  { key: "WILL_UPDATE", label: "Will update", tone: "good" },
  { key: "NO_CHANGE", label: "No change", tone: "good" },
  { key: "NO_MATCH", label: "No student with this mobile", tone: "bad" },
  { key: "MOBILE_SHARED", label: "Mobile shared by two students", tone: "bad" },
  { key: "DUPLICATE_IN_FILE", label: "Same mobile twice in the file", tone: "bad" },
  { key: "BAD_MOBILE", label: "Mobile No unusable", tone: "bad" },
  { key: "BAD_VALUE", label: "A value is not valid", tone: "bad" },
];

type Filter = "all" | "update" | "overwrite" | "problems";

interface PreviewResponse { results?: BulkUpdateResult[]; error?: string }
interface ApplyTotals {
  appliedCount: number; failedCount: number; skippedCount: number;
  applied: BulkUpdateResult[]; failed: (BulkUpdateResult & { error: string })[]; skipped: BulkUpdateResult[];
}
const EMPTY_TOTALS: ApplyTotals = { appliedCount: 0, failedCount: 0, skippedCount: 0, applied: [], failed: [], skipped: [] };

const changeText = (r: BulkUpdateResult) =>
  r.changes.map((c) => (c.mode === "FILL" ? `${c.label}: (empty) -> ${c.after}` : `${c.label}: ${c.before} -> ${c.after}`)).join(" | ");

export function StudentDataUpdateImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [isBuildingTemplate, setIsBuildingTemplate] = useState(false);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<BulkUpdateRow[]>([]);
  const [fields, setFields] = useState<string[]>([]); // fields found in the uploaded file
  const [notes, setNotes] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [fillOnly, setFillOnly] = useState(false);

  const [results, setResults] = useState<BulkUpdateResult[] | null>(null);
  const [filter, setFilter] = useState<Filter>("update");
  const [reviewed, setReviewed] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [progress, setProgress] = useState("");
  const [applyResult, setApplyResult] = useState<ApplyTotals | null>(null);
  const [runId, setRunId] = useState("");

  const summary = useMemo(() => {
    const counts = Object.fromEntries(OUTCOME_LABELS.map((o) => [o.key, 0])) as Record<BulkUpdateOutcome, number>;
    for (const r of results ?? []) counts[r.outcome]++;
    return counts;
  }, [results]);
  const willUpdate = summary.WILL_UPDATE ?? 0;
  const overwriteCount = useMemo(
    () => (results ?? []).reduce((n, r) => n + r.changes.filter((c) => c.mode === "OVERWRITE").length, 0),
    [results]
  );
  const warningRows = (results ?? []).filter((r) => r.warnings.length > 0).length;

  const shown = useMemo(() => {
    const all = results ?? [];
    const list =
      filter === "update" ? all.filter((r) => r.outcome === "WILL_UPDATE")
      : filter === "overwrite" ? all.filter((r) => r.changes.some((c) => c.mode === "OVERWRITE"))
      : filter === "problems" ? all.filter((r) => r.outcome !== "WILL_UPDATE" && r.outcome !== "NO_CHANGE")
      : all;
    return list;
  }, [results, filter]);

  function reset() {
    setResults(null);
    setApplyResult(null);
    setReviewed(false);
    setProgress("");
  }

  function togglePick(key: string, on: boolean) {
    setPicked((prev) => { const next = new Set(prev); if (on) next.add(key); else next.delete(key); return next; });
  }

  const orderedPicked = BULK_UPDATE_GROUPS.flatMap((g) => g.keys).filter((k) => picked.has(k));

  // Two sheets: the first is the one to fill in (headers only - a sample or guidance row there would be read back as data)
  // and is read on upload; the second explains each column. Every column is formatted as Text so Excel doesn't turn long
  // numbers (Aadhar, bank A/C) into 1.2E+15 or rewrite dates.
  async function downloadTemplate() {
    if (orderedPicked.length === 0) return;
    setIsBuildingTemplate(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const headers = [MOBILE_HEADER, ...orderedPicked.map(bulkFieldLabel)];

      const template = workbook.addWorksheet("Template");
      template.addRow(headers);
      template.getRow(1).font = { bold: true };
      template.columns = headers.map((h) => ({ width: Math.min(Math.max(h.length + 2, 16), 40), style: { numFmt: "@" } }));

      const help = workbook.addWorksheet("Instructions");
      help.addRow(["Column", "What to enter"]);
      help.getRow(1).font = { bold: true };
      help.addRow([MOBILE_HEADER, "Required. The student's 10-digit mobile number exactly as already on their record - it finds the student and is never changed."]);
      for (const k of orderedPicked) help.addRow([bulkFieldLabel(k), FIELD_BY_KEY.get(k)?.sample ?? ""]);
      help.addRow([]);
      help.addRow(["Leave a cell blank to leave that value alone - blanks never clear anything. Fill the Template sheet only."]);
      help.columns = [{ width: 36 }, { width: 100 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "student_data_update_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Couldn't build the Excel template. Please try again." });
    } finally {
      setIsBuildingTemplate(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError("");
    reset();
    setFileName(file.name);
    setRows([]);
    setFields([]);
    setNotes([]);

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xls")) { setParseError("Legacy .xls files aren't supported - please re-save as .xlsx or .csv and try again."); return; }
    try {
      const parsed = lower.endsWith(".csv")
        ? parseCSVWithRowNumbers(await readFileAsText(file))
        : await parseExcelFileWithRowNumbers(file);
      if (parsed.rows.length < 2) { setParseError("That file has no rows under the header."); return; }

      const headers = parsed.rows[0].map((h) => h.trim());
      const keyMap = matchHeaders(headers, COLUMNS);
      const mobileAt = Object.entries(keyMap).find(([, k]) => k === "mobileNo")?.[0];
      if (mobileAt === undefined) { setParseError(`The file needs a "${MOBILE_HEADER}" column - it is how each row finds its student.`); return; }

      const used: { at: number; key: string }[] = [];
      const noteList: string[] = [];
      headers.forEach((h, i) => {
        if (!h) return;
        const key = keyMap[i];
        if (!key) { noteList.push(`"${h}" is not a column this import knows - ignored`); return; }
        if (key === "mobileNo") return;
        if (key === "rollNumber") { noteList.push(`"${h}" ignored - Roll No is set from the Map roll numbers tab`); return; }
        if (!isBulkUpdateField(key)) { noteList.push(`"${h}" ignored - ${bulkFieldLabel(key)} can't be changed with this import`); return; }
        if (used.some((u) => u.key === key)) { noteList.push(`"${h}" ignored - ${bulkFieldLabel(key)} is already in another column`); return; }
        used.push({ at: i, key });
      });
      if (used.length === 0) { setParseError("None of the columns in that file is a field this import can update. Download the template and use its columns."); return; }

      const parsedRows: BulkUpdateRow[] = parsed.rows.slice(1).map((cells, i) => {
        const values: Record<string, string> = {};
        for (const u of used) {
          const v = (cells[u.at] ?? "").trim();
          if (v) values[u.key] = v;
        }
        return { rowNumber: parsed.rowNumbers[i + 1] ?? i + 2, mobile: (cells[Number(mobileAt)] ?? "").trim(), values };
      }).filter((r) => r.mobile || Object.keys(r.values).length > 0);

      if (parsedRows.length === 0) { setParseError("Every row in that file is empty."); return; }
      if (parsedRows.length > MAX_BULK_UPDATE_ROWS) { setParseError(`That file has ${parsedRows.length} rows - split it into files of ${MAX_BULK_UPDATE_ROWS.toLocaleString()} or fewer.`); return; }

      setRows(parsedRows);
      setFields(used.map((u) => u.key));
      setNotes(noteList);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function preview(keepApplyResult = false) {
    if (rows.length === 0) return;
    setIsPreviewing(true);
    try {
      const res = await fetch("/api/college/students/bulk-update/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, fields, fillOnly }),
      });
      const json = (await res.json()) as PreviewResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not check the file");
      setResults(json.results ?? []);
      setReviewed(false);
      if (!keepApplyResult) setApplyResult(null);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not check the file" });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function apply() {
    if (!results || willUpdate === 0) return;
    setIsApplying(true);
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, "");
    setRunId(id);
    const byNumber = new Map(rows.map((r) => [r.rowNumber, r]));
    const todo = results.filter((r) => r.outcome === "WILL_UPDATE").map((r) => byNumber.get(r.rowNumber)).filter((r): r is BulkUpdateRow => !!r);
    const totals: ApplyTotals = { ...EMPTY_TOTALS, applied: [], failed: [], skipped: [] };
    let stoppedAt: string | null = null;

    for (let start = 0; start < todo.length; start += MAX_BULK_APPLY_ROWS) {
      setProgress(`Updating students ${start + 1}-${Math.min(start + MAX_BULK_APPLY_ROWS, todo.length)} of ${todo.length}...`);
      try {
        const res = await fetch("/api/college/students/bulk-update/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: todo.slice(start, start + MAX_BULK_APPLY_ROWS), fields, fillOnly, runId: id, fileName }),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<ApplyTotals> & { error?: string };
        if (!res.ok) { stoppedAt = json.error ?? "A batch could not be applied"; break; }
        totals.appliedCount += json.appliedCount ?? 0;
        totals.failedCount += json.failedCount ?? 0;
        totals.skippedCount += json.skippedCount ?? 0;
        totals.applied.push(...(json.applied ?? []));
        totals.failed.push(...(json.failed ?? []));
        totals.skipped.push(...(json.skipped ?? []));
      } catch {
        stoppedAt = "Network error - the run was stopped";
        break;
      }
    }

    setApplyResult(totals);
    setProgress("");
    setIsApplying(false);
    toast({
      variant: stoppedAt || totals.failedCount > 0 ? "destructive" : "success",
      title: `${totals.appliedCount} student${totals.appliedCount !== 1 ? "s" : ""} updated`,
      ...(stoppedAt ? { description: `${stoppedAt}. Everything before it was saved - re-check the file and apply again; finished rows will show as No change.` } : {}),
      ...(!stoppedAt && totals.failedCount > 0 ? { description: `${totals.failedCount} row(s) failed - download the results.` } : {}),
    });
    await preview(true); // shows what is now true, so a second apply is a no-op
  }

  function downloadResults() {
    const stamp = new Date().toISOString().slice(0, 10);
    const all = [
      ...(applyResult?.applied ?? []).map((r) => ({ r, status: "updated", error: "" })),
      ...(applyResult?.failed ?? []).map((r) => ({ r, status: "failed", error: r.error })),
      ...(applyResult?.skipped ?? []).map((r) => ({ r, status: "skipped", error: "" })),
    ].sort((a, b) => a.r.rowNumber - b.r.rowNumber);
    downloadCSV(
      toCSV([
        ["Row", "Student Mobile No", "Student", "Roll No", "Status", "Outcome", "Reason", "Changes"],
        ...all.map(({ r, status, error }) => [String(r.rowNumber), r.mobile, r.studentName ?? "", r.rollNumber ?? "", status, r.outcome, error || r.message, changeText(r)]),
      ]),
      `update-student-data-results-${stamp}.csv`
    );
  }

  function downloadBackup() {
    downloadCSV(
      toCSV([
        ["Row", "Student Mobile No", "Student", "Roll No", "Field", "Old value", "New value", "Run"],
        ...(applyResult?.applied ?? []).flatMap((r) =>
          r.changes.map((c) => [String(r.rowNumber), r.mobile, r.studentName ?? "", r.rollNumber ?? "", c.label, c.before, c.after, runId])
        ),
      ]),
      `update-student-data-old-values-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  const step = (n: number) => (
    <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">{n}</span>
  );
  const needsReview = overwriteCount > 0;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Update Student Data"
        description="Choose which details to update, then match each row to a student by Student Mobile No - nothing is written until you apply"
        actions={
          <Button variant="outline" asChild>
            <Link href="/college-office"><ArrowLeft className="h-4 w-4 mr-1" />Back to Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(1)}Choose the Fields to Update</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            {HINTS.map((h) => (
              <p key={h} className="flex items-start gap-1"><span className="text-primary mt-0.5">•</span>{h}</p>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked disabled />
            {MOBILE_HEADER} <span className="text-xs text-muted-foreground font-normal">(always included - the key)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setPicked(new Set(BULK_UPDATE_GROUPS.flatMap((g) => g.keys)))}>
              Select all fields
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
              Clear all
            </Button>
            <span className="text-xs text-muted-foreground">{picked.size} field{picked.size !== 1 ? "s" : ""} selected</span>
          </div>
          {BULK_UPDATE_GROUPS.map((g) => {
            const allOn = g.keys.every((k) => picked.has(k));
            return (
              <div key={g.title} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1">
                  <p className="text-sm font-semibold">{g.title}</p>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setPicked((prev) => { const next = new Set(prev); for (const k of g.keys) { if (allOn) next.delete(k); else next.add(k); } return next; })}
                  >
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.keys.map((k) => (
                    <label key={k} className="flex items-start gap-2 text-sm">
                      <Checkbox checked={picked.has(k)} onCheckedChange={(v) => togglePick(k, v === true)} />
                      <span>
                        {bulkFieldLabel(k)}
                        {k === "dateOfJoining" && <span className="block text-xs text-amber-600">Attendance is counted from this date</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(2)}Download Template</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {orderedPicked.length === 0
              ? "Pick at least one field above, then download a template with just those columns."
              : `The template will have ${MOBILE_HEADER} plus ${orderedPicked.length} column${orderedPicked.length !== 1 ? "s" : ""}: ${orderedPicked.map(bulkFieldLabel).join(", ")}.`}
          </p>
          <Button onClick={() => void downloadTemplate()} loading={isBuildingTemplate} disabled={orderedPicked.length === 0} className="gap-2">
            <Download className="h-4 w-4" />Download Template (Excel)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(3)}Upload Filled File</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void handleFile(e)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">Click to select a CSV or Excel file</p>
              <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx supported - needs a Student Mobile No column plus the columns to update</p>
            </div>
          </button>
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}
          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-green-700 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />{fileName} - {rows.length} row{rows.length !== 1 ? "s" : ""} read
              </p>
              <p className="text-sm">Fields found in the file: <span className="font-medium">{fields.map(bulkFieldLabel).join(", ")}</span></p>
              {notes.length > 0 && (
                <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  {notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(4)}Check Against the Roster</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={fillOnly} onCheckedChange={(v) => { setFillOnly(v === true); reset(); }} />
              <span>
                Fill blanks only (don&rsquo;t overwrite)
                <span className="block text-xs text-muted-foreground">
                  Off by default: a different value in the file replaces the one on the record. Tick this to only fill fields that are empty.
                </span>
              </span>
            </label>
            <Button onClick={() => void preview()} loading={isPreviewing} className="gap-2">
              <Search className="h-4 w-4" />Check {rows.length} Row{rows.length !== 1 ? "s" : ""}
            </Button>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">{step(5)}Preview ({results.length} rows)</CardTitle>
              {willUpdate === 0 && <Badge variant="destructive" className="text-xs">Nothing to apply</Badge>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {OUTCOME_LABELS.filter((o) => (summary[o.key] ?? 0) > 0).map((o) => (
                <Badge key={o.key} variant={o.tone === "good" ? "secondary" : o.tone === "warn" ? "in_progress" : "destructive"}>
                  {o.label}: {summary[o.key]}
                </Badge>
              ))}
              {overwriteCount > 0 && <Badge variant="in_progress">Values to overwrite: {overwriteCount}</Badge>}
            </div>
            {warningRows > 0 && (
              <div className="mx-5 mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {warningRows} student{warningRows !== 1 ? "s have" : " has"} need a look (amber text below): a cell Excel had already damaged is skipped, or an answer now disagrees with details on file. Nothing extra is erased.
              </div>
            )}
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {([["update", "Will update"], ["overwrite", "With overwrites"], ["problems", "Problems"], ["all", "All rows"]] as [Filter, string][]).map(([k, label]) => (
                <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{label}</Button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-2 font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Student Mobile No</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Student</th>
                    <th className="text-left p-2 font-medium text-muted-foreground">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 200).map((r) => (
                    <tr key={r.rowNumber} className={`border-b align-top ${r.outcome === "WILL_UPDATE" || r.outcome === "NO_CHANGE" ? "" : "bg-red-50"}`}>
                      <td className="p-2 text-muted-foreground">{r.rowNumber}</td>
                      <td className="p-2 whitespace-nowrap">{r.mobile || <span className="text-muted-foreground/40">-</span>}</td>
                      <td className="p-2 whitespace-nowrap">
                        {r.studentName ?? <span className="text-muted-foreground/40">-</span>}
                        {r.rollNumber ? <span className="text-muted-foreground"> ({r.rollNumber})</span> : null}
                      </td>
                      <td className="p-2 space-y-0.5">
                        <p className={r.outcome === "WILL_UPDATE" ? "text-green-700 font-medium" : "text-muted-foreground"}>{r.message}</p>
                        {r.changes.length > 0 && (
                          <dl className="mt-1 grid grid-cols-[minmax(9rem,13rem)_1fr] gap-x-3 gap-y-0.5">
                            {r.changes.map((c) => (
                              <div key={c.key} className="contents">
                                <dt className="font-semibold text-foreground">{c.label}</dt>
                                <dd className="break-words">
                                  <span className="text-muted-foreground">{c.mode === "FILL" ? "(empty)" : c.before}</span>
                                  <span className="mx-1.5 text-muted-foreground/60" aria-hidden>&rarr;</span>
                                  <span className="font-medium text-green-700">{c.after}</span>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {r.warnings.map((w) => <p key={w} className="text-amber-600">{w}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="text-xs text-muted-foreground p-3">No rows in this view.</p>}
              {shown.length > 200 && (
                <p className="text-xs text-muted-foreground p-3 border-t">Showing first 200 of {shown.length} rows in this view. All rows are included when you apply.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(6)}Apply</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {willUpdate === 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                No row in this file needs applying. Everything is already up to date or skipped for the reason shown above.
              </div>
            )}
            {needsReview && willUpdate > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
                <span>I have reviewed the {overwriteCount} value{overwriteCount !== 1 ? "s" : ""} that will be overwritten (old -&gt; new in the preview). The old values are saved with this run.</span>
              </label>
            )}
            <div className="flex flex-wrap gap-3 items-center">
              <Button onClick={() => void apply()} loading={isApplying} disabled={willUpdate === 0 || (needsReview && !reviewed)}>
                <Upload className="h-4 w-4 mr-2" />
                Update {willUpdate} Student{willUpdate !== 1 ? "s" : ""}
              </Button>
              <Button variant="outline" onClick={() => { setRows([]); setFields([]); setNotes([]); setFileName(""); reset(); }}>Clear</Button>
              {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {applyResult && (
        <Card className={applyResult.appliedCount > 0 && applyResult.failedCount === 0 ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              {applyResult.failedCount === 0 ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
              <p className="font-medium">
                {applyResult.appliedCount} student{applyResult.appliedCount !== 1 ? "s" : ""} updated
                {applyResult.failedCount > 0 && <span className="text-red-600"> &middot; {applyResult.failedCount} failed</span>}
                <span className="text-muted-foreground font-normal"> &middot; {applyResult.skippedCount} skipped</span>
              </p>
            </div>
            {applyResult.failed.length > 0 && (
              <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {applyResult.failed.slice(0, 10).map((f) => <p key={f.rowNumber}>Row {f.rowNumber} ({f.mobile}): {f.error}</p>)}
                {applyResult.failed.length > 10 && <p className="text-xs">...and {applyResult.failed.length - 10} more - download the results.</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={downloadResults} className="gap-2"><Download className="h-4 w-4" />Download Results</Button>
              {applyResult.appliedCount > 0 && (
                <Button variant="outline" size="sm" onClick={downloadBackup} className="gap-2"><Download className="h-4 w-4" />Download Old Values (backup)</Button>
              )}
            </div>
            {runId && <p className="text-xs text-muted-foreground">Run id {runId} - the old values are also saved on the server with this id.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
