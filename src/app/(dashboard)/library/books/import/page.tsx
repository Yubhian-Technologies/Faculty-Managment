"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Upload, FileSpreadsheet, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { parseCSV, parseExcelFile, matchHeaders, getUnmatchedHeaders, toCSV, downloadCSV } from "@/lib/utils/csv";

const COLUMNS = [
  { key: "title", label: "Title", required: true, sample: "Introduction to Algorithms" },
  { key: "author", label: "Author", required: true, sample: "Thomas H. Cormen" },
  { key: "isbn", label: "ISBN", required: true, sample: "9780262046305" },
  { key: "totalCopies", label: "Total Copies", required: true, sample: "3" },
  { key: "category", label: "Category", required: false, sample: "Computer Science" },
  { key: "publisher", label: "Publisher", required: false, sample: "MIT Press" },
];

type ParsedRow = Record<string, string>;
type ImportResult = { created: number; failed: { row: number; title: string; error: string }[] };

function downloadTemplate() {
  const header = COLUMNS.map((c) => c.label);
  const sample = COLUMNS.map((c) => c.sample);
  downloadCSV(toCSV([header, sample]), "book-catalog-template.csv");
}

export default function LibraryBooksImportPage() {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setIsParsing(true);
    setResult(null);
    try {
      const table = file.name.toLowerCase().endsWith(".csv")
        ? parseCSV(await file.text())
        : await parseExcelFile(file);
      if (table.length < 2) {
        toast({ variant: "destructive", title: "The file has no data rows" });
        return;
      }
      const [headerRow, ...dataRows] = table;
      const keyMap = matchHeaders(headerRow, COLUMNS);
      const unmatched = getUnmatchedHeaders(headerRow, keyMap);
      if (unmatched.length > 0) {
        toast({ variant: "destructive", title: "Unrecognized columns", description: unmatched.join(", ") });
        return;
      }
      const parsed: ParsedRow[] = dataRows
        .filter((r) => r.some((cell) => cell.trim()))
        .map((r) => {
          const row: ParsedRow = {};
          r.forEach((cell, i) => {
            const key = keyMap[i];
            if (key) row[key] = cell.trim();
          });
          return row;
        });
      setRows(parsed);
      setFileName(file.name);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to read file" });
    } finally {
      setIsParsing(false);
    }
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setIsImporting(true);
    try {
      const res = await fetch("/api/college/library/books/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: rows }),
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Import failed" });
        return;
      }
      setResult(json);
      if (json.created > 0) {
        toast({ variant: "success", title: `${json.created} book${json.created === 1 ? "" : "s"} added to the catalog` });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Import Books" description="Bulk-add books to the catalog from a spreadsheet" />
        <Button asChild variant="outline" size="sm">
          <Link href="/library/books"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">1. Download the template</p>
            <p className="text-xs text-muted-foreground mb-2">Title, Author, ISBN and Total Copies are required for every row. Category and Publisher are optional.</p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />Download Template (.csv)
            </Button>
          </div>

          <div className="pt-2 border-t">
            <p className="text-sm font-medium mb-1 mt-3">2. Upload your filled-in file</p>
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{fileName || "Click to choose a .csv or .xlsx file"}</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {isParsing && <p className="text-xs text-muted-foreground mt-2">Reading file...</p>}
          </div>

          {rows.length > 0 && !result && (
            <div className="pt-2 border-t space-y-3">
              <p className="text-sm">
                <strong>{rows.length}</strong> row{rows.length === 1 ? "" : "s"} ready to import.
              </p>
              <Button onClick={() => void handleImport()} loading={isImporting}>
                <Upload className="h-4 w-4 mr-2" />Import {rows.length} Book{rows.length === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {result && (
            <div className="pt-2 border-t space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{result.created} added</span>
                {result.failed.length > 0 && (
                  <>
                    <XCircle className="h-4 w-4 text-destructive ml-3" />
                    <span>{result.failed.length} skipped</span>
                  </>
                )}
              </div>
              {result.failed.length > 0 && (
                <div className="rounded-lg border divide-y">
                  {result.failed.map((f, i) => (
                    <div key={i} className="p-2.5 text-xs flex items-center justify-between gap-2">
                      <span className="font-medium">Row {f.row}: {f.title}</span>
                      <Badge variant="destructive">{f.error}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => { setRows([]); setFileName(""); setResult(null); }}>
                Import Another File
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
