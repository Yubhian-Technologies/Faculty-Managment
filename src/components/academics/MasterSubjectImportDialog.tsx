"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Download, Upload, FileSpreadsheet, XCircle, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { parseCSV, parseExcelFile, readFileAsText, matchHeaders } from "@/lib/utils/csv";
import { MASTER_IMPORT_COLUMNS, MASTER_IMPORT_HINTS } from "@/lib/subjects/masterImportColumns";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

interface ImportResult {
  created: number;
  failed: { row: number; code: string; error: string }[];
  warnings: { row: number; code: string; warning: string }[];
}

// Bulk-imports subjects straight into the master collection for one Course +
// Regulation - no department/year/semester asked here (see
// api/college/subjects/import). Assigning an imported subject to a
// department's semester stays this page's existing "Add Subject"/Assign flow.
export function MasterSubjectImportDialog({ open, onOpenChange, courseId, courseName, regulation, academicYear, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
  regulation: string;
  academicYear?: string;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

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

  async function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    try {
      const rows = file.name.toLowerCase().endsWith(".csv")
        ? parseCSV(await readFileAsText(file))
        : await parseExcelFile(file);
      if (rows.length < 2) { toast({ variant: "destructive", title: "File has no data rows" }); return; }

      const [headerRow, ...dataRows] = rows;
      const keyByIndex = matchHeaders(headerRow, MASTER_IMPORT_COLUMNS);
      const missing = MASTER_IMPORT_COLUMNS.filter((c) => c.required && !Object.values(keyByIndex).includes(c.key));
      if (missing.length > 0) {
        toast({ variant: "destructive", title: `Missing required column${missing.length !== 1 ? "s" : ""}: ${missing.map((c) => c.label).join(", ")}` });
        return;
      }

      const records: SubjectRowInput[] = dataRows
        .filter((r) => r.some((cell) => cell.trim()))
        .map((r) => {
          const row: Record<string, string> = {};
          for (const [idx, key] of Object.entries(keyByIndex)) row[key] = r[Number(idx)] ?? "";
          return row as unknown as SubjectRowInput;
        });

      if (records.length === 0) { toast({ variant: "destructive", title: "No data rows found" }); return; }

      setIsImporting(true);
      const res = await fetch("/api/college/subjects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, regulation, academicYear, records }),
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      if (json.created > 0) onImported();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to read file" });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setResult(null); setFileName(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Subjects</DialogTitle>
          <DialogDescription>
            Into the master collection for {courseName}{regulation ? ` · ${regulation}` : ""} - no department, year or semester needed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />Download Template
          </Button>

          <div className="space-y-1.5">
            <Label>Upload file (.csv or .xlsx)</Label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={isImporting}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            {fileName && <p className="text-xs text-muted-foreground flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" />{fileName}</p>}
          </div>

          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
            {MASTER_IMPORT_HINTS.map((h) => <li key={h}>{h}</li>)}
          </ul>

          {isImporting && <p className="text-sm flex items-center gap-2"><Upload className="h-4 w-4 animate-pulse" />Importing...</p>}

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result ? "Done" : "Cancel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
