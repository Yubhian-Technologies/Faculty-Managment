"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  UsersRound,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import {
  parseCSV,
  matchHeaders,
  getUnmatchedHeaders,
  parseExcelFile,
  readFileAsText,
  downloadCSV,
} from "@/lib/utils/csv";
import {
  LOCATION_STAFF_CSV_COLUMNS,
  generateLocationStaffCsvTemplate,
  generateLocationStaffSampleRows,
} from "@/lib/location/staffCsvColumns";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

type ParsedRow = Record<string, string>;

interface ImportResult {
  created: number;
  failed: { row: number; name: string; error: string }[];
  total: number;
  newDepartmentsCreated?: string[];
}

export default function LocationStaffBulkImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userLocationId = useAuthStore((s) => s.user?.locationId) ?? "";

  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBuildingExcel, setIsBuildingExcel] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Fetch campus departments and shifts to populate template and live validation
  useEffect(() => {
    const locParam = userLocationId ? `?locationId=${encodeURIComponent(userLocationId)}` : "";
    Promise.all([
      fetch(`/api/location/departments${locParam}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => setDepartments(d.departments ?? [])),
      fetch(`/api/location/shifts${locParam}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => setShifts(d.shifts ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load campus departments and shifts" }))
      .finally(() => setLoadingLookups(false));
  }, [userLocationId]);

  const deptLookup = useMemo(() => {
    const map = new Set<string>();
    for (const d of departments) {
      if (d.name) map.add(d.name.trim().toLowerCase());
      if (d.code) map.add(d.code.trim().toLowerCase());
    }
    return map;
  }, [departments]);

  // Download CSV Template
  function handleDownloadCsv() {
    const csvContent = generateLocationStaffCsvTemplate(departments, shifts);
    downloadCSV(csvContent, "location_staff_import_template.csv");
  }

  // Download Excel Template (Dynamic ExcelJS)
  async function handleDownloadExcel() {
    setIsBuildingExcel(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const headers = LOCATION_STAFF_CSV_COLUMNS.map((c) => c.label);
      const widths = headers.map((h) => ({ width: Math.max(h.length + 3, 14) }));

      // Sheet 1: Template
      const templateSheet = workbook.addWorksheet("Staff Import Template");
      templateSheet.addRow(headers);
      templateSheet.addRow(LOCATION_STAFF_CSV_COLUMNS.map((c) => c.sample));
      templateSheet.getRow(1).font = { bold: true };
      templateSheet.columns = widths;

      // Sheet 2: Samples
      const sampleSheet = workbook.addWorksheet("Sample Records");
      sampleSheet.addRow(headers);
      const samples = generateLocationStaffSampleRows(departments, shifts);
      for (const row of samples) {
        sampleSheet.addRow(LOCATION_STAFF_CSV_COLUMNS.map((c) => row[c.key] || ""));
      }
      sampleSheet.getRow(1).font = { bold: true };
      sampleSheet.columns = widths;

      // Sheet 3: Available Campus Reference
      const refSheet = workbook.addWorksheet("Departments & Shifts Reference");
      refSheet.addRow(["Available Departments", "Department Code", "Available Shifts", "Shift Timings"]);
      refSheet.getRow(1).font = { bold: true };
      const maxRows = Math.max(departments.length, shifts.length);
      for (let i = 0; i < maxRows; i++) {
        const d = departments[i];
        const s = shifts[i];
        refSheet.addRow([
          d ? d.name : "",
          d ? d.code || "" : "",
          s ? s.name : "",
          s ? `${s.startTime} - ${s.endTime}` : "",
        ]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "location_staff_import_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Failed to generate Excel template" });
    } finally {
      setIsBuildingExcel(false);
    }
  }

  // Handle file upload and parsing
  async function handleFileUpload(file: File) {
    setParseError("");
    setImportResult(null);
    setFileName(file.name);
    setIsParsing(true);

    try {
      let rawGrid: string[][];
      const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");

      if (isExcel) {
        rawGrid = await parseExcelFile(file);
      } else {
        const text = await readFileAsText(file);
        rawGrid = parseCSV(text);
      }

      if (rawGrid.length < 2) {
        setParseError("The file does not contain enough rows (header + at least 1 record required).");
        setRows([]);
        return;
      }

      const headers = rawGrid[0];
      const keyMap = matchHeaders(headers, LOCATION_STAFF_CSV_COLUMNS);

      // Check required columns mapped
      const missingRequired = LOCATION_STAFF_CSV_COLUMNS.filter(
        (col) => col.required && !Object.values(keyMap).includes(col.key)
      );

      if (missingRequired.length > 0) {
        setParseError(
          `Missing required header columns: ${missingRequired.map((m) => m.label).join(", ")}`
        );
        setRows([]);
        return;
      }

      // Convert rows into parsed objects
      const parsed: ParsedRow[] = [];
      for (let i = 1; i < rawGrid.length; i++) {
        const rowCells = rawGrid[i];
        if (!rowCells.some((c) => c && c.trim())) continue; // Skip blank rows

        const rowObj: ParsedRow = {};
        rowCells.forEach((val, idx) => {
          const mappedKey = keyMap[idx];
          if (mappedKey) {
            rowObj[mappedKey] = val.trim();
          }
        });
        parsed.push(rowObj);
      }

      if (parsed.length === 0) {
        setParseError("No valid data rows found in the uploaded file.");
        setRows([]);
        return;
      }

      setRows(parsed);
    } catch (err) {
      console.error(err);
      setParseError(err instanceof Error ? err.message : "Failed to parse file.");
      setRows([]);
    } finally {
      setIsParsing(false);
    }
  }

  // Row validation helper for UI preview
  function validateRow(row: ParsedRow, index: number): string | null {
    if (!row.name) return "Name required";
    if (!row.contactNumber || !/^\d{10}$/.test(row.contactNumber)) return "Phone must be 10 digits";
    if (!row.aadhaar || !/^\d{12}$/.test(row.aadhaar)) return "Aadhaar must be 12 digits";
    if (!row.role) return "Role required";
    // NOTE: Department is NOT treated as an error! If not already on campus,
    // the system will seamlessly auto-create the department during import.
    if (row.spouseGuardianPhone && !/^\d{10}$/.test(row.spouseGuardianPhone)) {
      return "Spouse phone must be 10 digits";
    }
    if (row.spouseGuardianAadhaar && !/^\d{12}$/.test(row.spouseGuardianAadhaar)) {
      return "Spouse Aadhaar must be 12 digits";
    }
    return null;
  }

  const newDeptsInFile = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const dept = r.department?.trim();
      if (dept && !deptLookup.has(dept.toLowerCase())) {
        set.add(dept);
      }
    }
    return Array.from(set);
  }, [rows, deptLookup]);

  const rowValidationErrors = useMemo(() => {
    return rows.map((r, i) => validateRow(r, i));
  }, [rows]);

  const validRowCount = useMemo(() => {
    return rowValidationErrors.filter((e) => e === null).length;
  }, [rowValidationErrors]);

  // Execute bulk import
  async function handleExecuteImport() {
    if (rows.length === 0) return;
    setIsImporting(true);

    try {
      const res = await fetch("/api/location/staff/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff: rows,
          locationId: userLocationId || undefined,
        }),
      });

      const data = (await res.json()) as ImportResult & { error?: string };

      if (!res.ok) {
        throw new Error(data.error || "Failed to process bulk staff import");
      }

      setImportResult(data);
      if (data.created > 0) {
        const extraMsg =
          data.newDepartmentsCreated && data.newDepartmentsCreated.length > 0
            ? ` (${data.newDepartmentsCreated.length} new campus department(s) created)`
            : "";
        toast({
          title: "Import Complete",
          description: `Successfully registered ${data.created} staff member(s)${extraMsg}.`,
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Import Error",
        description: err instanceof Error ? err.message : "Internal error during import",
      });
    } finally {
      setIsImporting(false);
    }
  }

  function handleReset() {
    setRows([]);
    setFileName("");
    setParseError("");
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="Bulk Import Staff"
          description="Register multiple campus staff members simultaneously using CSV or Excel"
        />
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <Link href="/location-staff-admin/staff">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Staff Directory
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Instruction & Template Download Cards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Guidelines */}
        <Card className="lg:col-span-2 shadow-xs border-border/80">
          <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Info className="h-4 w-4 text-primary" />
              <span>Bulk Import Guidelines & Mandatory Fields</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 space-y-3 text-xs text-muted-foreground leading-relaxed">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border bg-card/60 space-y-1">
                <p className="font-bold text-foreground">Required Columns</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong>Staff Name</strong>: Full legal name</li>
                  <li><strong>Contact Number</strong>: Exactly 10 digits</li>
                  <li><strong>Aadhaar Number</strong>: Exactly 12 digits</li>
                  <li><strong>Department</strong>: Existing campus department</li>
                  <li><strong>Role</strong>: Designation (Guard, Driver, etc.)</li>
                  <li><strong>Payee Voucher</strong>: VOUCHER, CONTRACT, etc.</li>
                </ul>
              </div>
              <div className="p-3 rounded-lg border bg-card/60 space-y-1">
                <p className="font-bold text-foreground">Optional Columns</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong>Shift Name</strong>: Configured shift (e.g. Morning)</li>
                  <li><strong>Father Name</strong> & <strong>Address</strong></li>
                  <li><strong>Spouse/Guardian Details</strong> (Name, Phone, Aadhaar)</li>
                  <li><strong>Date of Joining</strong> (YYYY-MM-DD)</li>
                  <li><strong>Status</strong>: ACTIVE or INACTIVE</li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Duplicate check: The system prevents duplicate Aadhaar registrations within the same campus automatically.
            </p>
          </CardContent>
        </Card>

        {/* Template Downloads */}
        <Card className="shadow-xs border-border/80 flex flex-col justify-between">
          <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Download className="h-4 w-4 text-primary" />
              <span>Download Formats</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 space-y-3 flex-1 flex flex-col justify-center">
            <p className="text-xs text-muted-foreground">
              Download pre-filled templates with your campus departments and shifts included as samples:
            </p>
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={loadingLookups}
                className="w-full justify-start gap-2 h-9 text-xs"
              >
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span>Download CSV Template (.csv)</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadExcel}
                disabled={loadingLookups || isBuildingExcel}
                className="w-full justify-start gap-2 h-9 text-xs"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{isBuildingExcel ? "Generating Excel..." : "Download Excel Template (.xlsx)"}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Upload Area ── */}
      <Card className="shadow-xs border-dashed border-2">
        <CardContent className="p-6 sm:p-8 text-center space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
            }}
          />

          <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Upload className="h-6 w-6" />
          </div>

          <div className="space-y-1">
            <h3 className="font-bold text-base text-foreground">
              {fileName ? fileName : "Upload Staff CSV or Excel Workbook"}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Select or drag and drop your completed spreadsheet to preview and validate records.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing || isImporting}
              size="sm"
              className="gap-2 font-semibold"
            >
              {isParsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Parsing file...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>{rows.length > 0 ? "Choose Different File" : "Select File"}</span>
                </>
              )}
            </Button>

            {rows.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={handleReset} className="text-xs">
                Clear
              </Button>
            )}
          </div>

          {parseError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2 justify-center max-w-md mx-auto">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Import Results Banner (Post-execution) ── */}
      {importResult && (
        <Card
          className={`shadow-xs border ${
            importResult.created > 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
          }`}
        >
          <CardHeader className="p-4 sm:p-5 border-b">
            <CardTitle className="text-base font-bold flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {importResult.created > 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <span>Import Summary</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold">
                  {importResult.created} Successful
                </Badge>
                {importResult.failed.length > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive font-bold">
                    {importResult.failed.length} Failed
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 space-y-4">
            <p className="text-sm">
              Processed {importResult.total} row(s). {importResult.created} staff member(s) have been added to the campus database.
            </p>

            {importResult.newDepartmentsCreated && importResult.newDepartmentsCreated.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Auto-created {importResult.newDepartmentsCreated.length} new campus department(s):
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {importResult.newDepartmentsCreated.map((deptName, i) => (
                    <Badge key={i} variant="outline" className="bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/30 text-xs">
                      {deptName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {importResult.failed.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-destructive uppercase tracking-wider">
                  Skipped / Failed Records ({importResult.failed.length})
                </p>
                <div className="max-h-60 overflow-y-auto rounded-lg border divide-y divide-border text-xs bg-background">
                  {importResult.failed.map((f, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        Row {f.row}: {f.name}
                      </span>
                      <span className="text-destructive font-medium">{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button asChild size="sm">
                <Link href="/location-staff-admin/staff">View Staff Directory</Link>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                Import Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Parsed Rows Preview Table ── */}
      {rows.length > 0 && !importResult && (
        <Card className="shadow-xs border-border/80">
          <CardHeader className="p-4 sm:p-5 border-b bg-card/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <UsersRound className="h-4 w-4 text-primary" />
                <span>Parsed Staff Records ({rows.length})</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{validRowCount} valid record(s)</span>
                {rows.length - validRowCount > 0 && (
                  <span className="text-destructive font-medium">• {rows.length - validRowCount} error(s)</span>
                )}
                {newDeptsInFile.length > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1">
                    • <Sparkles className="h-3 w-3" /> {newDeptsInFile.length} new department(s) will be created ({newDeptsInFile.join(", ")})
                  </span>
                )}
              </p>
            </div>

            <Button
              type="button"
              onClick={handleExecuteImport}
              disabled={isImporting || rows.length === 0}
              size="sm"
              className="gap-2 font-bold bg-primary text-primary-foreground"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Importing Staff...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Confirm & Import {rows.length} Staff</span>
                </>
              )}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[460px] no-scrollbar">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-muted/50 border-b sticky top-0 z-10 backdrop-blur">
                  <tr>
                    <th className="p-2.5 font-bold w-12 text-center border-r">#</th>
                    <th className="p-2.5 font-bold border-r">Status</th>
                    <th className="p-2.5 font-bold border-r">Staff Name</th>
                    <th className="p-2.5 font-bold border-r">Phone</th>
                    <th className="p-2.5 font-bold border-r">Aadhaar</th>
                    <th className="p-2.5 font-bold border-r">Department</th>
                    <th className="p-2.5 font-bold border-r">Role</th>
                    <th className="p-2.5 font-bold border-r">Shift</th>
                    <th className="p-2.5 font-bold">Payee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, idx) => {
                    const error = rowValidationErrors[idx];
                    return (
                      <tr
                        key={idx}
                        className={`hover:bg-muted/20 transition-colors ${
                          error ? "bg-destructive/5" : ""
                        }`}
                      >
                        <td className="p-2.5 text-center text-muted-foreground border-r font-mono">
                          {idx + 1}
                        </td>
                        <td className="p-2.5 border-r">
                          {error ? (
                            <Badge variant="destructive" className="text-[10px] gap-1 px-1.5 py-0.5">
                              <AlertTriangle className="h-3 w-3" />
                              <span className="truncate max-w-[140px]" title={error}>
                                {error}
                              </span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-semibold">
                              Ready
                            </Badge>
                          )}
                        </td>
                        <td className="p-2.5 font-medium text-foreground border-r">{row.name || "—"}</td>
                        <td className="p-2.5 font-mono text-muted-foreground border-r">{row.contactNumber || "—"}</td>
                        <td className="p-2.5 font-mono text-muted-foreground border-r">{row.aadhaar || "—"}</td>
                        <td className="p-2.5 border-r">
                          {row.department ? (
                            deptLookup.has(row.department.trim().toLowerCase()) ? (
                              <span className="font-semibold text-foreground">{row.department}</span>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-foreground">{row.department}</span>
                                <Badge
                                  variant="outline"
                                  className="text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 px-1 py-0 gap-0.5"
                                  title="New department - will be created automatically on campus"
                                >
                                  <Sparkles className="h-2.5 w-2.5 inline" />
                                  New
                                </Badge>
                              </div>
                            )
                          ) : (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          )}
                        </td>
                        <td className="p-2.5 text-foreground border-r">{row.role || "—"}</td>
                        <td className="p-2.5 text-muted-foreground border-r">{row.shift || "—"}</td>
                        <td className="p-2.5 text-muted-foreground font-mono">{row.payeeVoucher || "VOUCHER"}</td>
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
