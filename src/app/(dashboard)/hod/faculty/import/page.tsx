"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { toCSV, parseCSV, downloadCSV, matchHeaders, getUnmatchedHeaders, parseExcelFile, readFileAsText } from "@/lib/utils/csv";
import { IMPORT_COLUMNS as COLUMNS, IMPORT_HINTS as HINTS } from "@/lib/faculty/csvColumns";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, Pencil } from "lucide-react";

type ParsedRow = Record<string, string>;
type ImportResult = {
  created: number;
  failed: { row: number; employeeId: string; error: string }[];
  warnings: { row: number; employeeId: string; warning: string }[];
};
// A skipped row plus its own original field values (snapshotted from `rows`
// before it's cleared on partial success - see handleImport) and the row's
// live status: "failed" until fixed and retried, then "fixed" (kept in the
// list, struck through, rather than vanishing) - same pattern as the student
// roster importer's own fix-and-retry flow (college-office/students/import).
type FailedRow = { row: number; employeeId: string; error: string; data: ParsedRow; status: "failed" | "fixed" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FacultyImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
  const user = useAuthStore((s) => s.user);
  const myDepartments = user?.departments && user.departments.length > 0 ? user.departments : (user?.department ? [user.department] : []);
  // The template has no per-row Department column - every row in one import
  // lands in the same department - so an HOD running more than one must say
  // which one up front, same rule the API enforces.
  const [importDepartment, setImportDepartment] = useState("");

  function downloadTemplate() {
    const headers = COLUMNS.map((c) => c.label);
    const sample1 = COLUMNS.map((c) => c.sample);
    downloadCSV(toCSV([headers, sample1]), "faculty_import_template.csv");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setRows([]);
    setResult(null);
    setFailedRows([]);

    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx");
    if (name.endsWith(".xls")) {
      setParseError("Legacy .xls files aren't supported - please re-save as .xlsx or .csv and try again.");
      e.target.value = "";
      return;
    }

    try {
      const parsed = isExcel ? await parseExcelFile(file) : parseCSV(await readFileAsText(file));
      if (parsed.length < 2) { setParseError("File must have a header row and at least one data row."); return; }

      const headers = parsed[0].map((h) => h.trim());
      // Map header labels to column keys - tolerant of case, punctuation, spacing,
      // and common alternate wording (e.g. "DOJ" for "Joining Date").
      const keyMap = matchHeaders(headers, COLUMNS);

      // Check header matching BEFORE counting data rows - if nothing in the
      // header row matched, every row maps to an empty object and would
      // otherwise surface as the misleading "no data rows" error instead of
      // pointing at the real problem (wrong/missing header row).
      const mappedCount = Object.keys(keyMap).length;
      if (mappedCount === 0) {
        setParseError("None of the columns in this file matched the template. Make sure the header row is the first row, and its wording is close to the template (e.g. \"Employee ID\", \"DOJ\").");
        return;
      }
      if (!Object.values(keyMap).includes("employeeId") && !Object.values(keyMap).includes("name")) {
        setParseError("Couldn't find an \"Employee ID\" or \"Name\" column. Check your file's header row against the template.");
        return;
      }
      // Every header must map to a known template column - a column that
      // doesn't match is far more likely a typo/wrong wording than data the
      // uploader intended to drop, so reject the whole file and say exactly
      // which column(s) are the problem instead of silently importing
      // without them.
      const unmatched = getUnmatchedHeaders(headers, keyMap);
      if (unmatched.length > 0) {
        setParseError(`These column(s) don't match any template column, so nothing was imported: ${unmatched.map((h) => `"${h}"`).join(", ")}. Rename them to match the template (see the hints above) or remove them, then re-upload.`);
        return;
      }

      const dataRows = parsed.slice(1).map((cells) => {
        const row: ParsedRow = {};
        cells.forEach((val, i) => {
          if (keyMap[i]) row[keyMap[i]] = val;
        });
        return row;
      }).filter((r) => Object.values(r).some((v) => v.trim())); // skip fully-blank rows

      if (dataRows.length === 0) { setParseError("No data rows found after the header - check that your data starts on the row right after the header, with no blank rows in between."); return; }
      if (dataRows.length > 500) { setParseError("Maximum 500 rows allowed per import."); return; }

      setRows(dataRows);
    } catch {
      setParseError(isExcel ? "Failed to parse the Excel file. Ensure it is a valid, uncorrupted .xlsx file." : "Failed to parse the file. Ensure it is a valid CSV.");
    } finally {
      e.target.value = "";
    }
  }

  async function handleImport() {
    if (rows.length === 0) return;
    if (myDepartments.length > 1 && !importDepartment) {
      toast({ variant: "destructive", title: "Choose which department this import belongs to" });
      return;
    }
    setIsImporting(true);
    setResult(null);
    setFailedRows([]);
    try {
      const res = await fetch("/api/college/faculty/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: rows, ...(importDepartment ? { department: importDepartment } : {}) }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      // Snapshot each failed row's own original values before `rows` is
      // cleared below (on any partial success) - the "fix and retry" dialog
      // needs them, and this is the only place they still exist.
      setFailedRows(json.failed.map((f) => ({ ...f, data: rows[f.row - 2] ?? {}, status: "failed" as const })));
      if (json.created > 0) {
        toast({ variant: "success", title: `${json.created} faculty imported successfully` });
        setRows([]);
      }
    } catch {
      toast({ variant: "destructive", title: "Network error - import failed" });
    } finally {
      setIsImporting(false);
    }
  }

  // ── Failed-row "fix and retry" dialog - reuses this SAME bulk import
  // endpoint with a single-row `records` array, rather than the single
  // "Add Faculty" endpoint (POST /api/college/faculty), since that one
  // always requires a password and mints a brand new login - this endpoint
  // already has the right semantics for one row of CSV-shaped data (optional
  // password, designation/employment-type text mapping, lenient date
  // parsing), so re-running the corrected row through it is both simpler and
  // guaranteed consistent with why the row failed the first time. ─────────
  const [fixTarget, setFixTarget] = useState<{ row: number; form: ParsedRow } | null>(null);
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState("");

  function openFix(f: FailedRow) {
    setFixError("");
    setFixTarget({ row: f.row, form: { ...f.data } });
  }

  function setFixField(key: string, value: string) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));
  }

  async function handleFixSave() {
    if (!fixTarget) return;
    setFixSaving(true);
    setFixError("");
    try {
      const res = await fetch("/api/college/faculty/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [fixTarget.form], ...(importDepartment ? { department: importDepartment } : {}) }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { setFixError(json.error ?? "Failed to save"); return; }
      if (json.created >= 1) {
        toast({ variant: "success", title: `${fixTarget.form.name || "Faculty member"} imported` });
        setFailedRows((prev) => prev.map((r) => (r.row === fixTarget.row ? { ...r, status: "fixed" as const } : r)));
        setFixTarget(null);
        return;
      }
      // Still failed (or only produced a warning, no created row) - surface
      // the specific reason and let them keep correcting in place.
      setFixError(json.failed?.[0]?.error ?? "Failed to save - please check the fields and try again");
    } catch {
      setFixError("Network error - please try again");
    } finally {
      setFixSaving(false);
    }
  }

  const requiredKeys = COLUMNS.filter((c) => c.required).map((c) => c.key);
  const missingRequired = rows.length > 0
    ? rows.some((r) => requiredKeys.some((k) => !r[k]?.trim()))
    : false;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import Faculty"
        description="Bulk upload faculty records from a CSV file"
        actions={
          <Button variant="outline" asChild>
            <Link href="/hod/faculty"><ArrowLeft className="h-4 w-4 mr-1" />Back to Faculty</Link>
          </Button>
        }
      />

      {myDepartments.length > 1 && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <Label>Importing into which department? <span className="text-destructive">*</span></Label>
            <Select value={importDepartment} onValueChange={setImportDepartment}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Download Template */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>Download Template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download the CSV template, fill in your faculty data, and upload it below. All date fields must be in <strong>YYYY-MM-DD</strong> format.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            {HINTS.map((h) => <p key={h} className="flex items-start gap-1"><span className="text-primary mt-0.5">•</span>{h}</p>)}
          </div>
          <Button onClick={downloadTemplate} className="gap-2">
            <Download className="h-4 w-4" />Download Template (CSV)
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Upload CSV */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>Upload Filled CSV</CardTitle></CardHeader>
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
              <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx supported - headers matched loosely (e.g. &quot;DOJ&quot; for Joining Date)</p>
            </div>
          </button>
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}
          {rows.length > 0 && (
            <p className="text-sm text-green-700 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />{rows.length} row{rows.length !== 1 ? "s" : ""} parsed successfully
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Preview */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                Preview ({rows.length} records)
              </CardTitle>
              {missingRequired && (
                <Badge variant="destructive" className="text-xs">Missing required fields</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-2 font-medium text-muted-foreground w-8">#</th>
                    {COLUMNS.filter((c) => rows.some((r) => r[c.key])).map((c) => (
                      <th key={c.key} className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">
                        {c.label}{c.required && <span className="text-red-500 ml-0.5">*</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, i) => {
                    const missing = requiredKeys.some((k) => !row[k]?.trim());
                    return (
                      <tr key={i} className={`border-b ${missing ? "bg-red-50" : i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="p-2 text-muted-foreground">{i + 2}</td>
                        {COLUMNS.filter((c) => rows.some((r) => r[c.key])).map((c) => (
                          <td key={c.key} className={`p-2 whitespace-nowrap ${c.required && !row[c.key]?.trim() ? "text-red-600 font-medium" : ""}`}>
                            {row[c.key]
                              ? (c.key === "password" ? "•".repeat(Math.min(row[c.key].length, 10)) : row[c.key])
                              : <span className="text-muted-foreground/40">-</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 20 && (
                <p className="text-xs text-muted-foreground p-3 border-t">
                  Showing first 20 of {rows.length} rows. All rows will be imported.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Import */}
      {rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>Import</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {missingRequired && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                Some rows have missing required fields (highlighted in red above). Those rows will be skipped during import.
              </div>
            )}
            <div className="flex gap-3">
              <Button onClick={() => void handleImport()} loading={isImporting} disabled={isImporting}>
                <Upload className="h-4 w-4 mr-2" />
                Import {rows.length} Record{rows.length !== 1 ? "s" : ""}
              </Button>
              <Button variant="outline" onClick={() => { setRows([]); setResult(null); }}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (() => {
        const stillFailed = failedRows.filter((f) => f.status === "failed");
        const fixed = failedRows.filter((f) => f.status === "fixed");
        return (
          <Card className={result.created > 0 || fixed.length > 0 ? "border-green-200" : "border-red-200"}>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                {result.created > 0
                  ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
                  : <XCircle className="h-6 w-6 text-red-600 shrink-0" />
                }
                <div>
                  <p className="font-semibold">{result.created} record{result.created !== 1 ? "s" : ""} imported successfully</p>
                  {failedRows.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {stillFailed.length} row{stillFailed.length !== 1 ? "s" : ""} skipped
                      {fixed.length > 0 ? ` · ${fixed.length} fixed just now` : ""}
                    </p>
                  )}
                  {result.warnings.length > 0 && (
                    <p className="text-sm text-amber-700">{result.warnings.length} note{result.warnings.length !== 1 ? "s" : ""} on imported rows</p>
                  )}
                </div>
              </div>
              {failedRows.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Skipped rows</p>
                  <p className="text-xs text-muted-foreground">
                    Click <Pencil className="h-3 w-3 inline" /> on a row to correct it and import it on its own, without re-uploading the file.
                  </p>
                  <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                    {failedRows.map((f) => (
                      <div key={f.row} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${f.status === "fixed" ? "opacity-50" : ""}`}>
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Row {f.row} · {f.data.name || f.employeeId}</span>
                          {f.status === "fixed" ? (
                            <span className="ml-2 text-green-600 text-xs">Fixed and imported</span>
                          ) : (
                            <span className="block text-red-600 text-xs">{f.error}</span>
                          )}
                        </div>
                        {f.status === "failed" && (
                          <button
                            onClick={() => openFix(f)}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            title="Edit and retry this row"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Imported, with notes</p>
                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Row {w.row} · {w.employeeId}</span>
                        <span className="text-amber-700 text-xs">{w.warning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(result.created > 0 || fixed.length > 0) && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/hod/faculty">View Faculty List</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Dialog open={!!fixTarget} onOpenChange={(o) => !o && setFixTarget(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fix Row {fixTarget?.row}</DialogTitle>
            <DialogDescription>
              Correct the field(s) that failed and save - this imports just this one faculty member, the same as the rest of the file.
            </DialogDescription>
          </DialogHeader>

          {fixTarget && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {COLUMNS.map((c) => (
                <div key={c.key} className="space-y-1.5">
                  <Label htmlFor={`fix-${c.key}`}>{c.label}{c.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                  <Input
                    id={`fix-${c.key}`}
                    type={c.key === "password" ? "password" : "text"}
                    value={fixTarget.form[c.key] ?? ""}
                    onChange={(e) => setFixField(c.key, e.target.value)}
                    placeholder={c.sample || undefined}
                  />
                </div>
              ))}
            </div>
          )}

          {fixError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {fixError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFixTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleFixSave()} loading={fixSaving}>Save &amp; Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
