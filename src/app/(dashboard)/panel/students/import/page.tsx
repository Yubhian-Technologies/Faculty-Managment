"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle } from "lucide-react";
import type { Section } from "@/types";

const COLUMNS = [
  { key: "sno", label: "S.No", required: false, sample: "1" },
  { key: "rollNumber", label: "Roll Number", required: true, sample: "21A91A0501" },
  { key: "name", label: "Student Name", required: true, sample: "K. Ravi Teja" },
  { key: "status", label: "Status", required: false, sample: "Regular" },
];

function toCSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (cell.includes(",") || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n");
}

function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let inQuotes = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    result.push(cells);
  }
  return result;
}

type ParsedRow = Record<string, string>;
type ImportResult = { created: number; failed: { row: number; rollNumber: string; error: string }[] };

export default function StudentImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: Section[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }));
  }, []);

  function downloadTemplate() {
    const headers = COLUMNS.map((c) => c.label);
    const sample = COLUMNS.map((c) => c.sample);
    const csv = toCSV([headers, sample]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setRows([]);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) { setParseError("File must have a header row and at least one data row."); return; }

        const headers = parsed[0].map((h) => h.trim());
        const keyMap: Record<number, string> = {};
        headers.forEach((h, i) => {
          const col = COLUMNS.find((c) => c.label.toLowerCase() === h.toLowerCase());
          if (col) keyMap[i] = col.key;
        });

        const dataRows = parsed.slice(1).map((cells) => {
          const row: ParsedRow = {};
          cells.forEach((val, i) => { if (keyMap[i]) row[keyMap[i]] = val; });
          return row;
        }).filter((r) => r.rollNumber || r.name);

        if (dataRows.length === 0) { setParseError("No data rows found after the header."); return; }
        if (dataRows.length > 500) { setParseError("Maximum 500 rows allowed per import."); return; }

        setRows(dataRows);
      } catch {
        setParseError("Failed to parse the file. Ensure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleImport() {
    if (rows.length === 0 || !sectionId) return;
    setIsImporting(true);
    setResult(null);
    try {
      const res = await fetch("/api/college/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, records: rows }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      if (json.created > 0) {
        toast({ variant: "success", title: `${json.created} students imported successfully` });
        setRows([]);
      }
    } catch {
      toast({ variant: "destructive", title: "Network error — import failed" });
    } finally {
      setIsImporting(false);
    }
  }

  const requiredKeys = COLUMNS.filter((c) => c.required).map((c) => c.key);
  const missingRequired = rows.length > 0 ? rows.some((r) => requiredKeys.some((k) => !r[k]?.trim())) : false;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Import Students"
        description="Bulk upload a student roster from a CSV file"
        actions={
          <Button variant="outline" asChild>
            <Link href="/panel/students"><ArrowLeft className="h-4 w-4 mr-1" />Back to Students</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>Select Section</CardTitle></CardHeader>
        <CardContent>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder={sections.length ? "Select section" : "No sections assigned to you"} /></SelectTrigger>
            <SelectContent>
              {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>Download Template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Columns: S.No, Roll Number, Student Name, Status (Regular/Detained). Section and Year come from your selection above.
          </p>
          <Button onClick={downloadTemplate} className="gap-2">
            <Download className="h-4 w-4" />Download Template (CSV)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>Upload Filled CSV</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} disabled={!sectionId} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!sectionId}
            className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">{sectionId ? "Click to select CSV file" : "Select a section first"}</p>
              <p className="text-xs text-muted-foreground mt-1">Only .csv files are supported</p>
            </div>
          </button>
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{parseError}
            </div>
          )}
          {rows.length > 0 && (
            <p className="text-sm text-green-700 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />{rows.length} row{rows.length !== 1 ? "s" : ""} parsed successfully
            </p>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                Import ({rows.length} records)
              </CardTitle>
              {missingRequired && <Badge variant="destructive" className="text-xs">Missing required fields</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {missingRequired && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                Some rows are missing Roll Number or Name and will be skipped.
              </div>
            )}
            <div className="flex gap-3">
              <Button onClick={() => void handleImport()} loading={isImporting} disabled={isImporting}>
                <Upload className="h-4 w-4 mr-2" />Import {rows.length} Record{rows.length !== 1 ? "s" : ""}
              </Button>
              <Button variant="outline" onClick={() => { setRows([]); setResult(null); }}>Clear</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className={result.created > 0 ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              {result.created > 0
                ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
                : <XCircle className="h-6 w-6 text-red-600 shrink-0" />}
              <div>
                <p className="font-semibold">{result.created} record{result.created !== 1 ? "s" : ""} imported successfully</p>
                {result.failed.length > 0 && (
                  <p className="text-sm text-muted-foreground">{result.failed.length} row{result.failed.length !== 1 ? "s" : ""} skipped</p>
                )}
              </div>
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                {result.failed.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Row {f.row} · {f.rollNumber}</span>
                    <span className="text-red-600 text-xs">{f.error}</span>
                  </div>
                ))}
              </div>
            )}
            {result.created > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/panel/students">View Roster</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
