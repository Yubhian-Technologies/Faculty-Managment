"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle } from "lucide-react";

// ─── Template definition ───────────────────────────────────────────────────────

const COLUMNS = [
  { key: "employeeId",        label: "Employee ID",                  required: true,  sample: "VIT001" },
  { key: "name",              label: "Name",                         required: true,  sample: "Dr. A. Ravi Kumar" },
  { key: "email",             label: "Personal Email",               required: true,  sample: "ravi@gmail.com" },
  { key: "phone",             label: "Phone",                        required: false, sample: "9876543210" },
  { key: "designation",       label: "Designation",                  required: true,  sample: "Asst. Prof." },
  { key: "qualification",     label: "Qualification",                required: true,  sample: "M.Tech" },
  { key: "specialization",    label: "Specialization",               required: false, sample: "Machine Learning" },
  { key: "employmentType",    label: "Employment Type",              required: true,  sample: "Regular" },
  { key: "joiningDate",       label: "Joining Date (YYYY-MM-DD)",    required: true,  sample: "2020-06-01" },
  { key: "experienceYears",   label: "Experience Years",             required: false, sample: "5" },
  { key: "industryExperience",label: "Industry Exp (Years)",         required: false, sample: "2" },
  { key: "researchExperience",label: "Research Exp (Years)",         required: false, sample: "1" },
  { key: "gender",            label: "Gender",                       required: false, sample: "Male" },
  { key: "dateOfBirth",       label: "Date of Birth (YYYY-MM-DD)",   required: false, sample: "1990-05-15" },
  { key: "legalName",         label: "Legal Name (as per SSC)",      required: false, sample: "RAVI KUMAR ANNAPU" },
  { key: "fatherName",        label: "Father / Husband Name",        required: false, sample: "ANNAPU SRINIVAS" },
  { key: "motherName",        label: "Mother Name",                  required: false, sample: "ANNAPU LAKSHMI" },
  { key: "aadharNo",          label: "Aadhar No",                    required: false, sample: "1234 5678 9012" },
  { key: "panNo",             label: "PAN No",                       required: false, sample: "ABCDE1234F" },
  { key: "religion",          label: "Religion",                     required: false, sample: "Hindu" },
  { key: "caste",             label: "Caste",                        required: false, sample: "OC" },
  { key: "collegeEmail",      label: "College Email",                required: false, sample: "ravi@vishnu.edu.in" },
  { key: "ratificationStatus",label: "Ratification Status",          required: false, sample: "Ratified" },
  { key: "ratificationDate",  label: "Ratification Date (YYYY-MM-DD)", required: false, sample: "2021-04-27" },
  { key: "hasPHD",            label: "Has PhD (Yes/No)",             required: false, sample: "No" },
  { key: "internalScore",     label: "Internal Score",               required: false, sample: "12.1" },
  { key: "externalScore",     label: "External Score",               required: false, sample: "3.0" },
  { key: "inCampusScore",     label: "In Campus Score",              required: false, sample: "1.0" },
];

const HINTS = [
  "Designation: Professor, Assoc. Prof., Asst. Prof., Lecturer, Visiting Faculty, Lab Assistant",
  "Employment Type: Regular, Permanent, Contract, Visiting, Part-Time",
  "Gender: Male, Female, Other",
  "Ratification Status: Ratified, Not Ratified",
  "Has PhD: Yes or No",
  "Dates must be in YYYY-MM-DD format (e.g. 2020-06-01)",
  "Department is auto-assigned from your HOD profile",
];

// ─── CSV helpers ───────────────────────────────────────────────────────────────

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
type ImportResult = { created: number; failed: { row: number; employeeId: string; error: string }[] };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FacultyImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function downloadTemplate() {
    const headers = COLUMNS.map((c) => c.label);
    const sample1 = COLUMNS.map((c) => c.sample);
    const csv = toCSV([headers, sample1]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faculty_import_template.csv";
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
        // Map header labels to column keys
        const colKeys = COLUMNS.map((c) => c.label);
        const keyMap: Record<number, string> = {};
        headers.forEach((h, i) => {
          const col = COLUMNS.find((c) => c.label.toLowerCase() === h.toLowerCase());
          if (col) keyMap[i] = col.key;
        });

        const dataRows = parsed.slice(1).map((cells) => {
          const row: ParsedRow = {};
          cells.forEach((val, i) => {
            if (keyMap[i]) row[keyMap[i]] = val;
          });
          return row;
        }).filter((r) => r.employeeId || r.name); // skip blank rows

        if (dataRows.length === 0) { setParseError("No data rows found after the header."); return; }
        if (dataRows.length > 500) { setParseError("Maximum 500 rows allowed per import."); return; }

        // Warn about unmapped columns
        const mappedCount = Object.keys(keyMap).length;
        if (mappedCount < 3) {
          setParseError(`Only ${mappedCount} column(s) matched. Make sure you're using the downloaded template headers.`);
          return;
        }

        void colKeys; // suppress unused warning
        setRows(dataRows);
      } catch {
        setParseError("Failed to parse the file. Ensure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setIsImporting(true);
    setResult(null);
    try {
      const res = await fetch("/api/college/faculty/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: rows }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      if (json.created > 0) {
        toast({ variant: "success", title: `${json.created} faculty imported successfully` });
        setRows([]);
      }
    } catch {
      toast({ variant: "destructive", title: "Network error — import failed" });
    } finally {
      setIsImporting(false);
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
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">Click to select CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">Only .csv files are supported</p>
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
                            {row[c.key] || <span className="text-muted-foreground/40">—</span>}
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
      {result && (
        <Card className={result.created > 0 ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              {result.created > 0
                ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
                : <XCircle className="h-6 w-6 text-red-600 shrink-0" />
              }
              <div>
                <p className="font-semibold">{result.created} record{result.created !== 1 ? "s" : ""} imported successfully</p>
                {result.failed.length > 0 && (
                  <p className="text-sm text-muted-foreground">{result.failed.length} row{result.failed.length !== 1 ? "s" : ""} skipped</p>
                )}
              </div>
            </div>
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Skipped rows</p>
                <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                  {result.failed.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Row {f.row} · {f.employeeId}</span>
                      <span className="text-red-600 text-xs">{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.created > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/hod/faculty">View Faculty List</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
