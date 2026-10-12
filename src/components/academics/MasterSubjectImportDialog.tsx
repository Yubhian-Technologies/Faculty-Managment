"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, FileSpreadsheet, XCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { parseCSV, parseExcelFile, readFileAsText, matchHeaders, getUnmatchedHeaders } from "@/lib/utils/csv";
import { MASTER_IMPORT_COLUMNS, MASTER_IMPORT_HINTS } from "@/lib/subjects/masterImportColumns";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

interface RowFailure { row: number; code: string; error: string; kind?: "unknown-category"; value?: string; suggestion?: string }
interface ImportResult {
  ok: boolean;
  created: number;
  failed: RowFailure[];
  warnings: { row: number; code: string; warning: string }[];
}

const PREVIEW_LIMIT = 100;

// Bulk-imports subjects straight into the master collection for one Course +
// Regulation - no department/year/semester asked here (see
// api/college/subjects/import). Assigning an imported subject to a
// department's semester stays the Subjects tab's own two-panel assign flow.
//
// Upload -> validate (dry run, every row checked against the same rules the
// commit uses) -> Import All only once every row reads OK, mirroring Course
// Structure's own upload/preview/commit pattern. A category that isn't
// defined yet blocks its row with a link to Categories instead of silently
// storing free text.
export function MasterSubjectImportDialog({ open, onOpenChange, courseId, courseName, regulation, academicYear, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
  regulation: string;
  academicYear?: string;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<{ fileName: string; records: { rowNumber: number; data: SubjectRowInput }[] } | null>(null);
  const [parseError, setParseError] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showProblemsOnly, setShowProblemsOnly] = useState(false);
  const validateRequestRef = useRef(0);

  function reset() {
    setUploaded(null);
    setParseError("");
    setPreview(null);
    setPreviewError("");
    setResult(null);
    setShowProblemsOnly(false);
  }

  function downloadTemplate() {
    const headers = MASTER_IMPORT_COLUMNS.map((c) => c.label);
    const sample = MASTER_IMPORT_COLUMNS.map((c) => c.sample);
    const csv = [headers, sample].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subjects-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runValidate(records: { rowNumber: number; data: SubjectRowInput }[], requestId: number) {
    setIsValidating(true);
    setPreviewError("");
    try {
      const res = await fetch("/api/college/subjects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "validate", courseId, regulation, academicYear, records: records.map((r) => r.data) }),
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (requestId !== validateRequestRef.current) return;
      if (res.status === 422 || res.ok) setPreview(json);
      else setPreviewError(json.error ?? "Couldn't check the file.");
    } catch {
      if (requestId === validateRequestRef.current) setPreviewError("Network error while checking the file.");
    } finally {
      if (requestId === validateRequestRef.current) setIsValidating(false);
    }
  }

  function refreshValidate() {
    if (!uploaded) return;
    void runValidate(uploaded.records, ++validateRequestRef.current);
  }

  async function handleFile(file: File) {
    reset();
    try {
      const rows = file.name.toLowerCase().endsWith(".csv")
        ? parseCSV(await readFileAsText(file))
        : await parseExcelFile(file);
      if (rows.length < 2) { setParseError("The file needs a header row and at least one subject row."); return; }

      const [headerRow, ...dataRows] = rows;
      const keyByIndex = matchHeaders(headerRow, MASTER_IMPORT_COLUMNS);
      const missing = MASTER_IMPORT_COLUMNS.filter((c) => c.required && !Object.values(keyByIndex).includes(c.key));
      if (missing.length > 0) {
        setParseError(`Missing required column${missing.length !== 1 ? "s" : ""}: ${missing.map((c) => c.label).join(", ")}`);
        return;
      }
      const unmatched = getUnmatchedHeaders(headerRow, keyByIndex);
      const filtered = dataRows.filter((r) => r.some((cell) => cell.trim()));
      if (filtered.length === 0) { setParseError("No data rows found."); return; }

      // rowNumber = i + 2 matches exactly how the server numbers rows (1-indexed
      // + header), since both sides walk this same filtered (blank rows
      // dropped) list - keeps the preview's row numbers and the server's
      // failed-row numbers pointing at the same row.
      const records = filtered.map((r, i) => {
        const data: Record<string, string> = {};
        for (const [idx, key] of Object.entries(keyByIndex)) data[key] = r[Number(idx)] ?? "";
        return { rowNumber: i + 2, data: data as unknown as SubjectRowInput };
      });
      setUploaded({ fileName: file.name, records });
      if (unmatched.length > 0) {
        toast({ title: `These columns don't match the template and were ignored: ${unmatched.map((h) => `"${h}"`).join(", ")}` });
      }
      void runValidate(records, ++validateRequestRef.current);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to read file");
    }
  }

  const errorsByRow = useMemo(() => {
    const m = new Map<number, RowFailure[]>();
    for (const f of preview?.failed ?? []) m.set(f.row, [...(m.get(f.row) ?? []), f]);
    return m;
  }, [preview]);
  // Each category the file names that isn't defined, once, with its row count.
  const unknownCategories = useMemo(() => {
    const map = new Map<string, { value: string; rows: number; suggestion?: string }>();
    for (const f of preview?.failed ?? []) {
      if (f.kind !== "unknown-category" || !f.value) continue;
      const entry = map.get(f.value) ?? { value: f.value, rows: 0, suggestion: f.suggestion };
      entry.rows++;
      map.set(f.value, entry);
    }
    return Array.from(map.values());
  }, [preview]);
  const readyToImport = !!preview && preview.ok && !isValidating && !result;
  const visibleRecords = useMemo(() => {
    const list = uploaded?.records ?? [];
    return (showProblemsOnly ? list.filter((r) => errorsByRow.has(r.rowNumber)) : list).slice(0, PREVIEW_LIMIT);
  }, [uploaded, showProblemsOnly, errorsByRow]);
  const rowErrorCount = new Set((preview?.failed ?? []).map((f) => f.row)).size;

  async function handleImport() {
    if (!uploaded || !readyToImport) return;
    setIsImporting(true);
    try {
      const res = await fetch("/api/college/subjects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit", courseId, regulation, academicYear, records: uploaded.records.map((r) => r.data) }),
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok && res.status !== 422) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      if (json.created > 0) onImported();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Network error." });
    } finally {
      setIsImporting(false);
    }
  }

  if (!open) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import Subjects</CardTitle>
        <p className="text-sm text-muted-foreground">
          Into the master collection for {courseName}{regulation ? ` · ${regulation}` : ""} - no department, year or semester here.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />Download Template
          </Button>

          <div className="space-y-1.5">
            <Label>Upload file (.csv or .xlsx)</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={isValidating || isImporting}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            {uploaded && <p className="text-xs text-muted-foreground flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />{uploaded.fileName}</p>}
          </div>

          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
            {MASTER_IMPORT_HINTS.map((h) => <li key={h}>{h}</li>)}
          </ul>

          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{parseError}
            </div>
          )}
        </div>

        {uploaded && !result && (
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 p-3">
              <p className="text-sm font-medium">Check the rows ({uploaded.records.length})</p>
              <div className="flex items-center gap-3 text-sm">
                {isValidating && <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</span>}
                {preview && !isValidating && (preview.failed.length > 0
                  ? <span className="text-red-600">{rowErrorCount} row{rowErrorCount !== 1 ? "s have" : " has"} problems</span>
                  : <span className="text-green-700 dark:text-green-400">All rows are valid</span>)}
                {preview && preview.failed.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setShowProblemsOnly((v) => !v)}>
                    {showProblemsOnly ? "Show all rows" : "Show problem rows only"}
                  </Button>
                )}
              </div>
            </div>

            {previewError && (
              <div className="m-3 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm">
                {previewError}
              </div>
            )}

            {unknownCategories.length > 0 && (
              <div className="m-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-sm space-y-2">
                <p className="font-medium">These categories aren&apos;t defined yet</p>
                <ul className="list-disc pl-5 text-xs space-y-0.5">
                  {unknownCategories.map((c) => (
                    <li key={c.value}>
                      {c.value}, {c.rows} row{c.rows !== 1 ? "s" : ""}
                      {c.suggestion ? `. If you meant ${c.suggestion}, change it in the file.` : ""}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href={`/academics/categories?add=${encodeURIComponent(unknownCategories.map((c) => c.value).join("|"))}`} target="_blank" rel="noopener">
                      Add these categories
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={refreshValidate} disabled={isValidating}>I&apos;ve added them, check again</Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="p-2 font-medium">Row</th>
                    <th className="p-2 font-medium">S.No.</th>
                    <th className="p-2 font-medium">Code</th>
                    <th className="p-2 font-medium">Subject</th>
                    <th className="p-2 font-medium">Category</th>
                    <th className="p-2 font-medium whitespace-nowrap">L-T-P</th>
                    <th className="p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map(({ rowNumber, data }) => {
                    const rowErrors = errorsByRow.get(rowNumber);
                    return (
                      <tr key={rowNumber} className={`border-b align-top ${rowErrors ? "bg-red-50 dark:bg-destructive/15" : ""}`}>
                        <td className="p-2 text-muted-foreground tabular-nums">{rowNumber}</td>
                        <td className="p-2">{data.serialNumber || "-"}</td>
                        <td className="p-2 font-mono">{data.code || "-"}</td>
                        <td className="p-2 min-w-40">{data.name || "-"}</td>
                        <td className="p-2">{data.category || "-"}</td>
                        <td className="p-2 whitespace-nowrap tabular-nums">{data.lectureHours || "?"}-{data.tutorialHours || "?"}-{data.practicalHours || "?"}</td>
                        <td className="p-2 min-w-56">
                          {rowErrors ? (
                            <ul className="space-y-0.5 text-red-600">
                              {rowErrors.map((f, i) => <li key={i} className="flex gap-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{f.error}</li>)}
                            </ul>
                          ) : preview && !isValidating ? (
                            <span className="text-green-700 dark:text-green-400">OK</span>
                          ) : (
                            <span className="text-muted-foreground">Checking…</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(showProblemsOnly ? rowErrorCount : uploaded.records.length) > PREVIEW_LIMIT && (
                <p className="text-xs text-muted-foreground p-3 border-t">Showing the first {PREVIEW_LIMIT} rows.</p>
              )}
            </div>
          </div>
        )}

        {uploaded && !result && (
          <div className="flex items-center gap-3">
            {preview && preview.failed.length > 0 ? (
              <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />Nothing can be imported until every row is fixed.</p>
            ) : null}
            <Button onClick={() => void handleImport()} loading={isImporting} disabled={!readyToImport || isImporting}>
              <Upload className="h-4 w-4 mr-2" />Import all {uploaded.records.length} row{uploaded.records.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}

        {result && (
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <p className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />{result.created} subject{result.created !== 1 ? "s" : ""} imported
            </p>
            {result.failed.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-destructive font-medium">
                  <XCircle className="h-4 w-4" />{result.failed.length} row{result.failed.length !== 1 ? "s" : ""} failed
                </p>
                <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-0.5">
                  {result.failed.map((f, i) => <li key={i}>Row {f.row} ({f.code}): {f.error}</li>)}
                </ul>
              </div>
            )}
            {result.warnings.length > 0 && (
              <ul className="text-xs text-amber-600 space-y-0.5">
                {result.warnings.map((w, i) => <li key={i}>Row {w.row} ({w.code}): {w.warning}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>{result ? "Done" : "Cancel"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
