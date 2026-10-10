"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Upload, FileSpreadsheet, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { importInChunks } from "@/lib/import/chunkedImport";
import {
  downloadCSV, getUnmatchedHeaders, matchHeaders, parseCSVWithRowNumbers, parseExcelFileWithRowNumbers, readFileAsText, toCSV,
} from "@/lib/utils/csv";
import { validateBulkRows, type BulkRowResult, type CleanBulkRow } from "@/lib/faculty/bulkCollegeEmailRows";

const COLUMNS = [
  { key: "employeeId", label: "Employee ID", aliases: ["Emp ID", "Employee Id", "EmployeeID", "Emp. ID"] },
  { key: "newEmail", label: "New College Email", aliases: ["New College Email ID", "New Email", "College Email", "College Email ID", "Email"] },
];
const CHUNK = 25; // rows per request - each row makes several login + database calls
const MAX_ROWS = 2000;

interface Summary { updated: number; unchanged: number; failed: number }

const STATUS_STYLE: Record<BulkRowResult["status"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  UPDATED: { label: "Updated", icon: CheckCircle2, className: "text-emerald-600" },
  UNCHANGED: { label: "Already same", icon: MinusCircle, className: "text-amber-600" },
  FAILED: { label: "Not updated", icon: XCircle, className: "text-destructive" },
};

// Bulk Change College Email: an Excel/CSV with Employee ID + New College Email. Every row follows exactly the same rules
// as the single "Change College Email" button (the server runs the same function): an address already used by anyone
// is refused, the same address as today is reported as "already same" and nothing is changed, an updated faculty member
// is signed out on all devices.
export default function BulkCollegeEmailImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CleanBulkRow[]>([]);
  const [rejected, setRejected] = useState<BulkRowResult[]>([]);
  const [parseError, setParseError] = useState("");
  const [fileName, setFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<BulkRowResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function downloadTemplate() {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      // Sheet one is the only one read back on upload - it holds the header row only, so nothing sample-like is ever imported.
      const t = wb.addWorksheet("Template");
      t.addRow(COLUMNS.map((c) => c.label));
      t.getRow(1).font = { bold: true };
      t.columns = [{ width: 18 }, { width: 38 }];
      const e = wb.addWorksheet("Example (not imported)");
      e.addRow(COLUMNS.map((c) => c.label));
      e.addRow(["EMP0001", "first.last@yourcollege.edu"]);
      e.addRow(["EMP0002", "another.name@yourcollege.edu"]);
      e.getRow(1).font = { bold: true };
      e.columns = [{ width: 18 }, { width: 38 }];
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = "faculty_college_email_template.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Couldn't build the Excel template. Please try again." });
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(""); setRows([]); setRejected([]); setResults(null); setSummary(null); setFileName(file.name);
    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx");
    if (name.endsWith(".xls")) {
      setParseError("Legacy .xls files aren't supported - please re-save as .xlsx or .csv and try again.");
      e.target.value = "";
      return;
    }
    try {
      const { rows: parsed, rowNumbers } = isExcel ? await parseExcelFileWithRowNumbers(file) : parseCSVWithRowNumbers(await readFileAsText(file));
      if (parsed.length < 2) { setParseError("The file needs a header row and at least one data row."); return; }
      const headers = parsed[0].map((h) => h.trim());
      const keyMap = matchHeaders(headers, COLUMNS);
      const mapped = Object.values(keyMap);
      if (!mapped.includes("employeeId") || !mapped.includes("newEmail")) {
        setParseError('The header row must have "Employee ID" and "New College Email" columns - download the template and use its headers.');
        return;
      }
      const unmatched = getUnmatchedHeaders(headers, keyMap);
      if (unmatched.length > 0) {
        setParseError(`These column(s) don't match the template, so nothing was imported: ${unmatched.map((h) => `"${h}"`).join(", ")}. Rename or remove them and upload again.`);
        return;
      }
      const data = parsed.slice(1).map((cells, i) => {
        const r: Record<string, string> = {};
        cells.forEach((v, c) => { if (keyMap[c]) r[keyMap[c]] = v; });
        return { fileRow: rowNumbers[i + 1], employeeId: r.employeeId ?? "", newEmail: r.newEmail ?? "" };
      }).filter((r) => r.employeeId.trim() || r.newEmail.trim());
      if (data.length === 0) { setParseError("No data rows found under the header."); return; }
      if (data.length > MAX_ROWS) { setParseError(`At most ${MAX_ROWS.toLocaleString()} rows per file - split it and upload in parts.`); return; }
      const { ok, rejected: bad } = validateBulkRows(data);
      setRows(ok);
      setRejected(bad);
    } catch {
      setParseError(isExcel ? "Failed to read the Excel file. Make sure it is a valid .xlsx file." : "Failed to read the file. Make sure it is a valid CSV.");
    } finally {
      e.target.value = "";
    }
  }

  async function handleUpdate() {
    if (rows.length === 0) return;
    setIsImporting(true); setResults(null); setSummary(null);
    try {
      const { merged, stoppedAt, error } = await importInChunks<{ results?: BulkRowResult[]; updated?: number; unchanged?: number; failed?: number }>(
        "/api/college/faculty/college-email-import", rows, { chunkSize: CHUNK, onProgress: (done, total) => setProgress({ done, total }) },
      );
      const done = merged.results ?? [];
      // Rows never sent because a chunk failed (network / server error) are listed too, so nothing silently goes missing.
      const unsent: BulkRowResult[] = stoppedAt === null ? [] : rows.slice(stoppedAt).map((r) => ({
        fileRow: r.fileRow, employeeId: r.employeeId, newEmail: r.newEmail, status: "FAILED" as const, code: "NOT_SENT",
        message: "Not processed - the upload stopped before this row. Upload the file again: rows already updated are reported as 'already same'.",
      }));
      const all = [...rejected, ...done, ...unsent].sort((a, b) => a.fileRow - b.fileRow);
      setResults(all);
      setSummary({
        updated: all.filter((r) => r.status === "UPDATED").length,
        unchanged: all.filter((r) => r.status === "UNCHANGED").length,
        failed: all.filter((r) => r.status === "FAILED").length,
      });
      setRows([]); setRejected([]);
      if (stoppedAt !== null) toast({ variant: "destructive", title: error ?? "The upload stopped part-way", description: `${stoppedAt} of ${rows.length} rows were processed.` });
      else toast({ variant: "success", title: "College email update finished" });
    } catch {
      toast({ variant: "destructive", title: "Network error - the update could not be completed" });
    } finally {
      setIsImporting(false); setProgress(null);
    }
  }

  function downloadResults() {
    if (!results) return;
    downloadCSV(toCSV([
      ["File row", "Employee ID", "Result", "Old college email", "New college email", "Details"],
      ...results.map((r) => [String(r.fileRow), r.employeeId, STATUS_STYLE[r.status].label, r.oldEmail ?? "", r.newEmail ?? "", r.message]),
    ]), "college_email_update_results.csv");
  }

  const hasPreview = rows.length > 0 || rejected.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Bulk Update College Emails"
        description="Change many faculty members' college email (their login) from one Excel/CSV file"
        actions={<Button variant="outline" asChild><Link href="/college-office/faculty"><ArrowLeft className="mr-2 h-4 w-4" />Back to Faculty</Link></Button>}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">How it works</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>One row per faculty member: their <strong>Employee ID</strong> (never changed - it is how each person is found) and the <strong>New College Email</strong>.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>An email that anyone already uses (another faculty member, staff, or any login) is <strong>not accepted</strong> for that row.</li>
            <li>If the new email is the same as their current one, the row says <strong>already same</strong> and nothing is changed.</li>
            <li>An email that is currently someone else&apos;s can&apos;t be given to another row in the same upload - change the other person first.</li>
            <li>Each updated faculty member is <strong>signed out on all devices</strong> and signs in again with their Employee ID and existing password, or the new email. They get an in-app notification (no email is sent).</li>
            <li>Their data, password and history are untouched. A row that can&apos;t be updated changes nothing, and never affects the other rows. An account whose login email and record email already differ is skipped for manual review.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Button variant="outline" onClick={() => void downloadTemplate()}><Download className="mr-2 h-4 w-4" />Download Template</Button>
          <Button onClick={() => fileRef.current?.click()} disabled={isImporting}><Upload className="mr-2 h-4 w-4" />Upload Excel / CSV</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={(e) => void handleFile(e)} className="sr-only" />
          {fileName && <span className="flex items-center gap-1 text-sm text-muted-foreground"><FileSpreadsheet className="h-4 w-4" />{fileName}</span>}
        </CardContent>
      </Card>

      {parseError && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{parseError}</p>}

      {hasPreview && !results && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ready to update</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="default">{rows.length} row{rows.length === 1 ? "" : "s"} will be checked and updated</Badge>
              {rejected.length > 0 && <Badge variant="destructive">{rejected.length} row{rejected.length === 1 ? "" : "s"} have problems and will be skipped</Badge>}
            </div>
            {rejected.length > 0 && (
              <ul className="space-y-1 text-sm">
                {rejected.slice(0, 50).map((r) => (
                  <li key={r.fileRow} className="text-destructive">Row {r.fileRow}{r.employeeId !== "-" ? ` · ${r.employeeId}` : ""}: {r.message}</li>
                ))}
                {rejected.length > 50 && <li className="text-muted-foreground">…and {rejected.length - 50} more (all are listed in the results)</li>}
              </ul>
            )}
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="p-2">Row</th><th className="p-2">Employee ID</th><th className="p-2">New College Email</th></tr></thead>
                <tbody>
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.fileRow} className="border-t"><td className="p-2">{r.fileRow}</td><td className="p-2">{r.employeeId}</td><td className="p-2">{r.newEmail}</td></tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && <p className="p-2 text-xs text-muted-foreground">Showing the first 100 of {rows.length} rows.</p>}
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => void handleUpdate()} loading={isImporting} disabled={rows.length === 0}>Update {rows.length} College Email{rows.length === 1 ? "" : "s"}</Button>
              {progress && <span className="text-sm text-muted-foreground">Processed {Math.min(progress.done + CHUNK, progress.total)} of {progress.total}…</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {results && summary && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Results</CardTitle>
            <Button variant="outline" size="sm" onClick={downloadResults}><Download className="mr-2 h-4 w-4" />Download results (CSV)</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="default">{summary.updated} updated</Badge>
              <Badge variant="secondary">{summary.unchanged} already same - no update</Badge>
              <Badge variant={summary.failed ? "destructive" : "outline"}>{summary.failed} not updated</Badge>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr><th className="p-2">Row</th><th className="p-2">Employee ID</th><th className="p-2">Result</th><th className="p-2">Details</th></tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const s = STATUS_STYLE[r.status];
                    const Icon = s.icon;
                    return (
                      <tr key={`${r.fileRow}-${r.employeeId}`} className="border-t align-top">
                        <td className="p-2">{r.fileRow}</td>
                        <td className="p-2">{r.employeeId}</td>
                        <td className={`p-2 whitespace-nowrap font-medium ${s.className}`}><Icon className="mr-1 inline h-4 w-4" />{s.label}</td>
                        <td className="p-2">
                          {r.message}
                          {r.status === "UPDATED" && r.oldEmail && <span className="block text-xs text-muted-foreground">{r.oldEmail} → {r.newEmail}</span>}
                          {r.status !== "UPDATED" && r.newEmail && <span className="block text-xs text-muted-foreground">{r.newEmail}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
