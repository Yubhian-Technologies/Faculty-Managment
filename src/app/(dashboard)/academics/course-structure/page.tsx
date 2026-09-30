"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { matchHeaders, getUnmatchedHeaders, parseExcelFileWithRowNumbers, parseCSVWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { IMPORT_COLUMNS, IMPORT_HINTS as HINTS } from "@/lib/subjects/csvColumns";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import {
  COURSE_STRUCTURE_MAX_ROWS,
  missingRequiredColumns,
  validateCourseStructureRows,
  type CourseStructureIssue,
  type CourseStructureRowInput,
} from "@/lib/subjects/courseStructureValidation";
import type { CourseStructureResult, CourseStructureScopeSummary } from "@/lib/subjects/services/CourseStructureImportService";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import { Download, Upload, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";

// Academics > Course Structure. One file = every subject of one
// Regulation + Course + Department, created and assigned to that
// department's semesters together or not at all:
//   1. pick Regulation / Course / Department -> the server returns exactly
//      which years and semesters this department may receive (scope panel)
//   2. upload -> every row is checked here with the same rules the server
//      uses (courseStructureValidation.ts), then the server dry-runs it
//      (existing subjects, already-assigned slots)
//   3. Import is enabled only when every row passes; the server commits
//      the whole file in one transaction and reads the links back.

type ParsedRow = Record<string, string>;
type Uploaded = { fileName: string; inputs: CourseStructureRowInput[] };

const PREVIEW_LIMIT = 100;

export default function CourseStructurePage() {
  return (
    <Suspense fallback={null}>
      <CourseStructurePageInner />
    </Suspense>
  );
}

function issueText(i: CourseStructureIssue) {
  return i.row > 0 ? `Row ${i.row}: ${i.message}` : i.message;
}

function CourseStructurePageInner() {
  const picker = useRegulationCourseDepartmentPicker();
  const searchParams = useSearchParams();

  // Deep-link prefill from principal/departments/[id]/page.tsx
  // (?catalogId=&departmentId=[&regulation=]) - Regulation/Course/Department
  // only; Year/Semester come from the file.
  const [prefill, setPrefill] = useState<{ catalogId: string; departmentId: string; regulation: string | null } | null>(() => {
    const catalogId = searchParams.get("catalogId");
    const departmentId = searchParams.get("departmentId");
    return catalogId && departmentId ? { catalogId, departmentId, regulation: searchParams.get("regulation") } : null;
  });
  useEffect(() => {
    if (!prefill || picker.catalogItems.length === 0) return;
    const item = picker.catalogItems.find((c) => c.id === prefill.catalogId);
    void (async () => {
      setPrefill(null);
      if (!item) return;
      const regs = item.regulations ?? [];
      picker.setSelectedRegulation(prefill.regulation && regs.includes(prefill.regulation) ? prefill.regulation : regs[0] ?? "");
      picker.setSelectedCatalogId(prefill.catalogId);
      picker.selectDepartment(prefill.departmentId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, picker.catalogItems]);

  // ── Scope: what this department may receive for this course ────────────
  const [scope, setScope] = useState<CourseStructureScopeSummary | null>(null);
  const [scopeError, setScopeError] = useState("");
  const [isLoadingScope, setIsLoadingScope] = useState(false);
  const scopeRequestRef = useRef(0);
  const courseId = picker.selectedCourse?.id ?? "";
  const departmentId = picker.selectedDepartmentId;
  const regulation = picker.selectedRegulation;
  useEffect(() => {
    const requestId = ++scopeRequestRef.current;
    void (async () => {
      setScope(null);
      setScopeError("");
      if (!courseId || !departmentId || !regulation) return;
      setIsLoadingScope(true);
      try {
        const qs = new URLSearchParams({ courseId, departmentId, regulation });
        const res = await fetch(`/api/college/subjects/import-and-assign?${qs}`);
        const json = await res.json() as CourseStructureScopeSummary & { error?: string };
        if (requestId !== scopeRequestRef.current) return;
        if (!res.ok) setScopeError(json.error ?? "Couldn't load this department's years and semesters.");
        else setScope(json);
      } catch {
        if (requestId === scopeRequestRef.current) setScopeError("Couldn't load this department's years and semesters.");
      } finally {
        if (requestId === scopeRequestRef.current) setIsLoadingScope(false);
      }
    })();
  }, [courseId, departmentId, regulation]);

  const teachableYears = scope?.scope.teachableYears ?? [];
  const canUpload = !!scope && teachableYears.length > 0;

  // ── Upload / validate / commit ─────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [parseError, setParseError] = useState("");
  const [parseWarning, setParseWarning] = useState("");
  const [serverCheck, setServerCheck] = useState<CourseStructureResult | null>(null);
  const [serverError, setServerError] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<CourseStructureResult | null>(null);
  const [showProblemsOnly, setShowProblemsOnly] = useState(false);
  const [isBuildingTemplate, setIsBuildingTemplate] = useState(false);

  function resetUploadState() {
    setUploaded(null);
    setParseError("");
    setParseWarning("");
    setServerCheck(null);
    setServerError("");
    setResult(null);
    setShowProblemsOnly(false);
  }

  const local = useMemo(
    () => (uploaded && scope ? validateCourseStructureRows(uploaded.inputs, scope.scope) : null),
    [uploaded, scope]
  );

  // Server dry run, once the file passes every local check.
  const checkRequestRef = useRef(0);
  useEffect(() => {
    const requestId = ++checkRequestRef.current;
    if (!uploaded || !local?.ok || !scope) return;
    void (async () => {
      setIsChecking(true);
      setServerCheck(null);
      setServerError("");
      try {
        const res = await fetch("/api/college/subjects/import-and-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "validate", courseId, departmentId, regulation, records: uploaded.inputs }),
        });
        const json = await res.json() as CourseStructureResult & { error?: string };
        if (requestId !== checkRequestRef.current) return;
        if (res.status === 422 || res.ok) setServerCheck(json);
        else setServerError(json.error ?? "Couldn't check the file.");
      } catch {
        if (requestId === checkRequestRef.current) setServerError("Network error while checking the file.");
      } finally {
        if (requestId === checkRequestRef.current) setIsChecking(false);
      }
    })();
  }, [uploaded, local, scope, courseId, departmentId, regulation]);

  const errors = useMemo(
    () => (serverCheck?.errors.length ? serverCheck.errors : local?.errors ?? []),
    [serverCheck, local]
  );
  const warnings = serverCheck ? serverCheck.warnings : local?.warnings ?? [];
  const errorsByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of errors) m.set(e.row, [...(m.get(e.row) ?? []), e.message]);
    return m;
  }, [errors]);
  const planByRow = useMemo(() => new Map((serverCheck?.plan ?? []).map((p) => [p.row, p])), [serverCheck]);
  const fileLevelErrors = errors.filter((e) => e.row === 0);
  const readyToImport = !!serverCheck?.ok && !isChecking && !result;

  async function downloadTemplate() {
    if (!scope) return;
    setIsBuildingTemplate(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const headers = IMPORT_COLUMNS.map((c) => c.label);
      const sheet = workbook.addWorksheet("Subjects");
      sheet.addRow(headers);
      sheet.getRow(1).font = { bold: true };
      sheet.columns = headers.map((h) => ({ width: Math.min(Math.max(h.length + 4, 10), 36) }));
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      // Dropdowns built from this department's own scope, so the sheet can't
      // name a year or semester the import would reject.
      const semesters = Array.from(new Set(teachableYears.flatMap((y) => scope.scope.semestersByYear[y] ?? []))).sort((a, b) => a - b);
      const lists: Record<string, string[]> = {
        year: teachableYears.map(String),
        semester: semesters.map(String),
        category: Object.keys(SUBJECT_CATEGORY_LABELS),
        type: ["Theory", "Practical", "Tutorial", "Project"],
      };
      IMPORT_COLUMNS.forEach((col, i) => {
        const values = lists[col.key];
        if (!values || values.length === 0) return;
        for (let r = 2; r <= COURSE_STRUCTURE_MAX_ROWS + 1; r++) {
          sheet.getCell(r, i + 1).dataValidation = {
            type: "list",
            allowBlank: !col.required,
            formulae: [`"${values.join(",")}"`],
            showErrorMessage: col.key !== "category",
            errorTitle: `Invalid ${col.label}`,
            error: `Pick one of: ${values.join(", ")}`,
          };
        }
      });

      // Reference sheets - never read back (only the first sheet is imported).
      const info = workbook.addWorksheet("Allowed Years & Semesters");
      info.addRow([`${scope.course.name}, ${scope.department.name}, regulation ${scope.regulation}`]).font = { bold: true };
      info.addRow([]);
      info.addRow(["Year", "Semesters", "Regulation(s) currently teaching this year"]).font = { bold: true };
      for (const y of teachableYears) {
        info.addRow([y, (scope.scope.semestersByYear[y] ?? []).join(", ") || "none configured",
          scope.regulationCoverage.find((c) => c.year === y)?.regulations.join(", ") ?? ""]);
      }
      info.columns = [{ width: 10 }, { width: 18 }, { width: 44 }];
      const sample = workbook.addWorksheet("Example");
      sample.addRow(headers).font = { bold: true };
      sample.addRow(IMPORT_COLUMNS.map((c) => c.sample));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scope.course.name}_${scope.department.name}_${scope.regulation}_subjects.xlsx`.replace(/[^A-Za-z0-9._-]+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Couldn't build the Excel template" });
    } finally {
      setIsBuildingTemplate(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    resetUploadState();
    if (!canUpload) { setParseError("Select Regulation, Course and Department above before uploading."); return; }

    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx");
    if (name.endsWith(".xls")) { setParseError(".xls files aren't supported. Save the file as .xlsx and try again."); return; }

    try {
      const { rows: parsed, rowNumbers } = isExcel ? await parseExcelFileWithRowNumbers(file) : parseCSVWithRowNumbers(await readFileAsText(file));
      if (parsed.length < 2) { setParseError("The file needs a header row and at least one subject row."); return; }

      const headers = parsed[0].map((h) => h.trim());
      const keyMap = matchHeaders(headers, IMPORT_COLUMNS);
      const missing = missingRequiredColumns(Object.values(keyMap));
      if (missing.length > 0) {
        const labels = missing.map((k) => IMPORT_COLUMNS.find((c) => c.key === k)?.label ?? k);
        setParseError(`These required columns are missing from the header row: ${labels.join(", ")}. Download the template to see the expected columns.`);
        return;
      }
      const unmatched = getUnmatchedHeaders(headers, keyMap);
      if (unmatched.length > 0) {
        setParseWarning(`These columns don't match the template and were ignored: ${unmatched.map((h) => `"${h}"`).join(", ")}.`);
      }

      const inputs: CourseStructureRowInput[] = [];
      parsed.slice(1).forEach((cells, i) => {
        const data: ParsedRow = {};
        cells.forEach((val, c) => { if (keyMap[c]) data[keyMap[c]] = val; });
        if (Object.values(data).some((v) => v.trim())) inputs.push({ rowNumber: rowNumbers[i + 1] ?? i + 2, data });
      });
      if (inputs.length === 0) { setParseError("No subject rows found under the header."); return; }
      if (inputs.length > COURSE_STRUCTURE_MAX_ROWS) {
        setParseError(`A single import can hold at most ${COURSE_STRUCTURE_MAX_ROWS} rows. This file has ${inputs.length}. Split it by year.`);
        return;
      }
      setUploaded({ fileName: file.name, inputs });
    } catch {
      setParseError(isExcel ? "Couldn't read this Excel file. Make sure it's a valid .xlsx file." : "Couldn't read this file. Make sure it's a valid CSV.");
    }
  }

  async function handleImport() {
    if (!uploaded || !readyToImport) return;
    setIsImporting(true);
    try {
      const res = await fetch("/api/college/subjects/import-and-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit", courseId, departmentId, regulation, records: uploaded.inputs }),
      });
      const json = await res.json() as CourseStructureResult & { error?: string };
      if (res.status === 422) {
        setServerCheck(json);
        toast({ variant: "destructive", title: "Nothing was imported. Fix the rows listed below." });
        return;
      }
      if (!res.ok) {
        // 409: configuration changed mid-import. Nothing was written; re-check.
        toast({ variant: "destructive", title: json.error ?? "Import failed. Nothing was saved." });
        setServerCheck(null);
        setUploaded((u) => (u ? { ...u } : u));
        return;
      }
      setResult(json);
      const problems = json.verification?.problems.length ?? 0;
      toast(problems > 0
        ? { variant: "destructive", title: `Imported, but ${problems} assignment${problems !== 1 ? "s don't" : " doesn't"} match. See below.` }
        : { variant: "success", title: `${json.counts.instancesWritten} subject${json.counts.instancesWritten !== 1 ? "s" : ""} assigned to ${scope?.department.name}` });
    } catch {
      toast({ variant: "destructive", title: "Network error. Reload the page to see whether the import was saved before trying again." });
    } finally {
      setIsImporting(false);
    }
  }

  const visibleInputs = useMemo(() => {
    const list = uploaded?.inputs ?? [];
    return (showProblemsOnly ? list.filter((r) => errorsByRow.has(r.rowNumber)) : list).slice(0, PREVIEW_LIMIT);
  }, [uploaded, showProblemsOnly, errorsByRow]);
  const rowErrorCount = new Set(errors.filter((e) => e.row > 0).map((e) => e.row)).size;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Course Structure"
        description="Import a course's subjects from one file and assign them to a department's semesters. Nothing is saved unless every row is valid."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

      <Card className="border-primary/20 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Regulation, Course and Department</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Regulation</Label>
            <Select value={picker.selectedRegulation} onValueChange={(v) => { picker.selectRegulation(v); resetUploadState(); }}>
              <SelectTrigger><SelectValue placeholder="Select regulation" /></SelectTrigger>
              <SelectContent>
                {picker.topLevelRegulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Course</Label>
            <Select value={picker.selectedCatalogId} onValueChange={(v) => { picker.selectCatalog(v); resetUploadState(); }} disabled={!picker.selectedRegulation}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedRegulation ? "Select a regulation first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {picker.catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={picker.selectedDepartmentId} onValueChange={(v) => { picker.selectDepartment(v); resetUploadState(); }} disabled={!picker.selectedCatalogId}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedCatalogId ? "Select a course first" : "Select department"} /></SelectTrigger>
              <SelectContent>
                {picker.departments.flatMap((d) => [
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>,
                  ...(picker.childrenOf.get(d.id) ?? []).map((child) => (
                    <SelectItem key={child.id} value={child.id} className="pl-6">{child.name}</SelectItem>
                  )),
                ])}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        {picker.selectedDepartmentId && !picker.isLoadingCourses && !picker.selectedCourse && (
          <CardContent className="pt-0">
            <p className="text-sm text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{picker.selectedDepartment?.name} doesn&apos;t teach this course yet.</p>
          </CardContent>
        )}
        {isLoadingScope && (
          <CardContent className="pt-0 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading years and semesters</CardContent>
        )}
        {scopeError && (
          <CardContent className="pt-0">
            <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />{scopeError}</p>
          </CardContent>
        )}
        {scope && (
          <CardContent className="pt-0 space-y-2">
            <p className="text-sm font-medium">
              Years and semesters assigned to {scope.department.name} for {scope.course.name}
            </p>
            {teachableYears.length === 0 ? (
              <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />No years are assigned to this department for this course. Set its Years Taught before importing.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: scope.scope.durationYears }, (_, i) => i + 1).map((y) => {
                  const taught = teachableYears.includes(y);
                  const sems = scope.scope.semestersByYear[y] ?? [];
                  const cov = scope.regulationCoverage.find((c) => c.year === y)?.regulations ?? [];
                  const existing = scope.existing.filter((e) => e.year === y);
                  return (
                    <div key={y} className={`rounded-md border p-2.5 text-xs space-y-1 ${taught ? "bg-background" : "opacity-50"}`}>
                      <div className="flex items-center justify-between font-medium text-sm">
                        <span>Year {y}</span>
                        {!taught && <span className="text-muted-foreground text-xs">not assigned</span>}
                      </div>
                      {taught && (
                        <>
                          <div>{sems.length > 0 ? `Semesters ${sems.join(", ")}` : <span className="text-red-600">No semesters configured</span>}</div>
                          {cov.length > 0 && (
                            <div className={cov.includes(scope.regulation) ? "text-muted-foreground" : "text-amber-700"}>Current batch regulation: {cov.join(", ")}</div>
                          )}
                          {existing.map((e) => (
                            <div key={e.semester} className="text-muted-foreground">Sem {e.semester}: {e.count} assigned{e.regulations.length > 0 ? ` (${e.regulations.join(", ")})` : ""}</div>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {canUpload && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">1. Download the template</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                {HINTS.map((h) => <li key={h}>{h}</li>)}
              </ul>
              <Button onClick={() => void downloadTemplate()} loading={isBuildingTemplate} className="gap-2"><Download className="h-4 w-4" />Download template (.xlsx)</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">2. Upload the filled file</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void handleFile(e)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer"
                aria-label="Click to upload an Excel or CSV file"
              >
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium text-sm">{uploaded ? `${uploaded.fileName} (click to choose a different file)` : "Click to choose an Excel or CSV file"}</p>
                  <p className="text-xs text-muted-foreground mt-1">.xlsx (first sheet is read) or .csv, up to {COURSE_STRUCTURE_MAX_ROWS} rows</p>
                </div>
              </button>
              {parseError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{parseError}
                </div>
              )}
              {!parseError && parseWarning && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-300 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{parseWarning}
                </div>
              )}
            </CardContent>
          </Card>

          {uploaded && local && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">3. Check the rows ({uploaded.inputs.length})</CardTitle>
                  <div className="flex items-center gap-3 text-sm">
                    {isChecking && <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking against existing subjects</span>}
                    {errors.length > 0 && <span className="text-red-600">{rowErrorCount || errors.length} row{(rowErrorCount || errors.length) !== 1 ? "s have" : " has"} problems</span>}
                    {readyToImport && <span className="text-green-700 dark:text-green-400">All rows are valid</span>}
                    {errors.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setShowProblemsOnly((v) => !v)}>
                        {showProblemsOnly ? "Show all rows" : "Show problem rows only"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {(fileLevelErrors.length > 0 || serverError) && (
                  <div className="mx-4 mb-3 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm space-y-1">
                    {serverError && <p>{serverError}</p>}
                    {fileLevelErrors.map((e, i) => <p key={i}>{e.message}</p>)}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                        <th className="p-2 font-medium">Row</th>
                        <th className="p-2 font-medium">Year</th>
                        <th className="p-2 font-medium">Sem</th>
                        <th className="p-2 font-medium">Code</th>
                        <th className="p-2 font-medium">Subject</th>
                        <th className="p-2 font-medium">Category</th>
                        <th className="p-2 font-medium whitespace-nowrap">L-T-P</th>
                        <th className="p-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleInputs.map(({ rowNumber, data }) => {
                        const rowErrors = errorsByRow.get(rowNumber);
                        const planned = planByRow.get(rowNumber);
                        return (
                          <tr key={rowNumber} className={`border-b align-top ${rowErrors ? "bg-red-50 dark:bg-destructive/15" : ""}`}>
                            <td className="p-2 text-muted-foreground tabular-nums">{rowNumber}</td>
                            <td className="p-2">{data.year || "-"}</td>
                            <td className="p-2">{data.semester || "-"}</td>
                            <td className="p-2 font-mono">{planned?.code ?? (data.code || <span className="text-muted-foreground">auto</span>)}</td>
                            <td className="p-2 min-w-40">{data.name || "-"}</td>
                            <td className="p-2">{data.category || "-"}</td>
                            <td className="p-2 whitespace-nowrap tabular-nums">{data.lectureHours || "?"}-{data.tutorialHours || "?"}-{data.practicalHours || "?"}</td>
                            <td className="p-2 min-w-56">
                              {rowErrors ? (
                                <ul className="space-y-0.5 text-red-600">
                                  {rowErrors.map((m, i) => <li key={i} className="flex gap-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{m}</li>)}
                                </ul>
                              ) : planned ? (
                                <span className="text-green-700 dark:text-green-400">
                                  {planned.instance === "unchanged" ? "Already assigned, no change"
                                    : planned.master === "reuse" ? "Uses existing subject" : "New subject"}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">OK</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {(showProblemsOnly ? rowErrorCount : uploaded.inputs.length) > PREVIEW_LIMIT && (
                    <p className="text-xs text-muted-foreground p-3 border-t">Showing the first {PREVIEW_LIMIT} rows.</p>
                  )}
                </div>
                {warnings.length > 0 && (
                  <div className="m-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs space-y-1">
                    <p className="font-medium text-sm">Warnings (these don&apos;t block the import)</p>
                    {warnings.map((w, i) => <p key={i}>{issueText(w)}</p>)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {uploaded && local && !result && (
            <Card>
              <CardHeader><CardTitle className="text-base">4. Import</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {errors.length > 0 ? (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    Nothing can be imported until every row is fixed. Correct the file and upload it again.
                  </div>
                ) : serverCheck?.ok ? (
                  <p className="text-sm text-muted-foreground">
                    {`Regulation ${regulation}, ${scope?.department.name}: ${serverCheck.counts.mastersCreated} new subject${serverCheck.counts.mastersCreated !== 1 ? "s" : ""}, `}
                    {`${serverCheck.counts.mastersReused} existing subject${serverCheck.counts.mastersReused !== 1 ? "s" : ""} reused, `}
                    {`${serverCheck.counts.instancesWritten} semester assignment${serverCheck.counts.instancesWritten !== 1 ? "s" : ""} to add`}
                    {serverCheck.counts.unchanged > 0 ? `, ${serverCheck.counts.unchanged} already assigned.` : "."}
                  </p>
                ) : null}
                <div className="flex gap-3">
                  <Button onClick={() => void handleImport()} loading={isImporting} disabled={!readyToImport || isImporting}>
                    <Upload className="h-4 w-4 mr-2" />Import all {uploaded.inputs.length} row{uploaded.inputs.length !== 1 ? "s" : ""}
                  </Button>
                  <Button variant="outline" onClick={resetUploadState}>Clear</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {result && (
            <Card className={result.verification?.problems.length ? "border-red-200" : "border-green-200"}>
              <CardContent className="p-5 space-y-3">
                <div>
                  <p className="font-semibold">Import complete</p>
                  <p className="text-sm text-muted-foreground">
                    {`${scope?.course.name}, regulation ${regulation}, ${scope?.department.name}: ${result.counts.mastersCreated} subjects created, ${result.counts.mastersReused} reused, ${result.counts.instancesWritten} semester assignments added`}
                    {result.counts.unchanged > 0 ? `, ${result.counts.unchanged} already assigned.` : "."}
                  </p>
                </div>
                {result.verification && (
                  result.verification.problems.length === 0 ? (
                    <p className="text-sm text-green-700 dark:text-green-400">
                      Checked {result.verification.checked} semester assignments after saving. Regulation, course, department, year and semester all match the file.
                    </p>
                  ) : (
                    <div className="text-sm text-red-700 dark:text-red-400 space-y-1">
                      <p className="font-medium">These semester assignments don&apos;t match the file:</p>
                      {result.verification.problems.map((p, i) => <p key={i}>{p}</p>)}
                    </div>
                  )
                )}
                <Button variant="outline" onClick={resetUploadState}>Import another file</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
