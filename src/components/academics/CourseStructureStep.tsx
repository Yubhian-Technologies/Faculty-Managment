"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { matchHeaders, getUnmatchedHeaders, parseExcelFileWithRowNumbers, parseCSVWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { IMPORT_COLUMNS, IMPORT_HINTS as HINTS } from "@/lib/subjects/csvColumns";
import type { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import {
  COURSE_STRUCTURE_MAX_ROWS,
  missingRequiredColumns,
  validateCourseStructureRows,
  type CourseStructureIssue,
  type CourseStructureRowInput,
} from "@/lib/subjects/courseStructureValidation";
import type { CourseStructureResult, CourseStructureScopeSummary } from "@/lib/subjects/services/CourseStructureImportService";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import { Download, Upload, XCircle, FileSpreadsheet, AlertTriangle, Loader2, Tags } from "lucide-react";
import { yearSemesterLabelIn } from "@/lib/academic/format";
import { MasterSubjectImportDialog } from "@/components/academics/MasterSubjectImportDialog";
import { CurriculumOverviewCard } from "@/components/academics/CurriculumOverviewCard";
import { SubjectsMasterTable } from "@/components/academics/SubjectsMasterTable";

// Curriculum > Structure step. One file = every subject of the shared scope
// bar's Regulation + Course + Department, created and assigned to that
// department's semesters together or not at all:
//   1. the shared scope bar above loads a Regulation/Course/Department -> the
//      server returns exactly which years and semesters this department may
//      receive (scope panel), fetched here whenever that selection changes
//   2. upload -> every row is checked here with the same rules the server
//      uses (courseStructureValidation.ts), then the server dry-runs it
//      (existing subjects, already-assigned slots)
//   3. Import is enabled only when every row passes; the server commits
//      the whole file in one transaction and reads the links back.

type ParsedRow = Record<string, string>;
type Uploaded = { fileName: string; inputs: CourseStructureRowInput[] };

const PREVIEW_LIMIT = 100;
// The old bundled "create subjects AND auto-assign to one department's
// semesters in one file" flow, superseded by Import Subjects above (plain
// regulation+course import) - kept, disabled, rather than deleted, so its
// dry-run/verification logic is still here if a bundled import is wanted
// again. A module-level const (not an inline literal) so TS's narrowing of
// `uploaded`/`result`/`serverCheck` inside the JSX below is unaffected.
const SHOW_BUNDLED_IMPORT = false;

function issueText(i: CourseStructureIssue) {
  return i.row > 0 ? `Row ${i.row}: ${i.message}` : i.message;
}

export function CourseStructureStep({ picker }: { picker: ReturnType<typeof useRegulationCourseDepartmentPicker> }) {
  // ── Scope: what this department may receive for this course ────────────
  // Re-fetched whenever the shared scope bar's selection changes (not on
  // every dropdown keystroke - only once it has actually loaded a course).
  const [scopeData, setScopeData] = useState<CourseStructureScopeSummary | null>(null);
  const [scopeError, setScopeError] = useState("");
  const [isLoadingScope, setIsLoadingScope] = useState(false);
  const scopeRequestRef = useRef(0);
  const scope = picker.isLoaded ? scopeData : null;
  const courseId = scope?.course.id ?? "";
  const departmentId = picker.selectedDepartmentId;
  const regulation = picker.selectedRegulation;

  async function fetchScope(cId: string, dId: string, reg: string, requestId: number) {
    setIsLoadingScope(true);
    try {
      const qs = new URLSearchParams({ courseId: cId, departmentId: dId, regulation: reg });
      const res = await fetch(`/api/college/subjects/import-and-assign?${qs}`);
      const json = await res.json() as CourseStructureScopeSummary & { error?: string };
      if (requestId !== scopeRequestRef.current) return;
      if (!res.ok) setScopeError(json.error ?? "Couldn't load this department's years and semesters.");
      else setScopeData(json);
    } catch {
      if (requestId === scopeRequestRef.current) setScopeError("Couldn't load this department's years and semesters.");
    } finally {
      if (requestId === scopeRequestRef.current) setIsLoadingScope(false);
    }
  }

  useEffect(() => {
    const requestId = ++scopeRequestRef.current;
    resetUploadState();
    setScopeData(null);
    setScopeError("");
    // The scope fetch (which years/semesters a DEPARTMENT may receive) only
    // matters for the disabled bundled-upload flow below - skip it entirely
    // without a department, so Structure's primary Import Subjects action
    // (course + regulation only) never surfaces a stray "departmentId is
    // required" error that has nothing to do with it.
    if (!picker.isLoaded || !picker.selectedCourse || !picker.selectedDepartmentId) return;
    void fetchScope(picker.selectedCourse.id, picker.selectedDepartmentId, picker.selectedRegulation, requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.isLoaded, picker.selectedCourse, picker.selectedDepartmentId, picker.selectedRegulation]);

  function refreshScope() {
    if (!picker.selectedCourse) return;
    void fetchScope(picker.selectedCourse.id, picker.selectedDepartmentId, picker.selectedRegulation, ++scopeRequestRef.current);
  }

  const teachableYears = scope?.scope.teachableYears ?? [];
  const canUpload = !!scope && teachableYears.length > 0;
  const [showMasterImport, setShowMasterImport] = useState(false);
  const [subjectsRefreshKey, setSubjectsRefreshKey] = useState(0);

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
  // Each category the file names that isn't defined, once, with its row count.
  const unknownCategories = useMemo(() => {
    const map = new Map<string, { value: string; rows: number; suggestion?: string }>();
    for (const e of errors) {
      if (e.kind !== "unknown-category" || !e.value) continue;
      const entry = map.get(e.value) ?? { value: e.value, rows: 0, suggestion: e.suggestion };
      entry.rows++;
      map.set(e.value, entry);
    }
    return Array.from(map.values());
  }, [errors]);
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
      // Configured semester numbers, plus 1..N for a file that counts each
      // year's semesters from 1 (the import maps them to the configured ones).
      const perYear = Math.max(0, ...teachableYears.map((y) => (scope.scope.semestersByYear[y] ?? []).length));
      const semesters = Array.from(new Set([
        ...teachableYears.flatMap((y) => scope.scope.semestersByYear[y] ?? []),
        ...Array.from({ length: perYear }, (_, i) => i + 1),
      ])).sort((a, b) => a - b);
      const categoryCodes = [...Object.keys(SUBJECT_CATEGORY_LABELS), ...(scope.scope.customCategories ?? []).map((c) => c.code)];
      const lists: Record<string, string[]> = {
        year: teachableYears.map(String),
        semester: semesters.map(String),
        // Excel caps an inline list at 255 characters.
        category: categoryCodes.join(",").length <= 250 ? categoryCodes : [],
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
      if (scope) void fetchScope(scope.course.id, scope.department.id, scope.regulation, ++scopeRequestRef.current);
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Import a course&apos;s subjects in bulk, scoped to the Regulation and Course above - assign them to a department&apos;s semesters afterwards on the Subjects tab.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/academics/categories"><Tags className="h-4 w-4 mr-1.5" />Categories</Link>
        </Button>
      </div>

      {isLoadingScope && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading this department&apos;s years and semesters…</p>
      )}
      {picker.isLoaded && scopeError && (
        <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />{scopeError}</p>
      )}

      {scope && <CurriculumOverviewCard scope={scope} />}

      {/* Import Subjects - regulation + course only, no department/year/
          semester. Needs just a loaded Course, not the full department scope
          canUpload below requires. */}
      {picker.isLoaded && picker.selectedCourse && (
        <Card>
          <CardHeader><CardTitle className="text-base">Import Subjects</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bulk-create subjects into the master collection for {picker.selectedCourse.name}
              {regulation ? ` · ${regulation}` : ""} - no department, year or semester here.
              Assign them to a department&apos;s semester afterwards on the Subjects tab.
            </p>
            <Button onClick={() => setShowMasterImport(true)}>Import Subjects</Button>
          </CardContent>
        </Card>
      )}
      <MasterSubjectImportDialog
        open={showMasterImport}
        onOpenChange={setShowMasterImport}
        courseId={picker.selectedCourse?.id ?? ""}
        courseName={picker.selectedCourse?.name ?? ""}
        regulation={regulation}
        onImported={() => {
          if (picker.selectedDepartmentId) void fetchScope(picker.selectedCourse!.id, picker.selectedDepartmentId, picker.selectedRegulation, ++scopeRequestRef.current);
          setSubjectsRefreshKey((k) => k + 1);
        }}
      />

      {/* The master subject list for this Course + Regulation, paginated,
          with inline edit/delete - what "Load" actually opens into. */}
      {picker.isLoaded && picker.selectedCourse && (
        <SubjectsMasterTable
          key={`${picker.selectedCourse.id}|${regulation}|${subjectsRefreshKey}`}
          courseId={picker.selectedCourse.id}
          courseName={picker.selectedCourse.name}
          regulation={regulation}
        />
      )}

      {/* Bulk subject creation used to also live here - regulation + course
          only now, no department/year/semester entanglement. This old
          flow (creates subjects AND auto-assigns them to one department's
          semesters in the same step) is kept, disabled, rather than deleted -
          its dry-run/verification logic stays available to restore if a
          bundled "whole curriculum table in one file" import is wanted again
          later. */}
      {SHOW_BUNDLED_IMPORT && canUpload && (
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
                {unknownCategories.length > 0 && (
                  <div className="mx-4 mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-sm space-y-2">
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
                          Define these categories
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={refreshScope} disabled={isLoadingScope}>I&apos;ve defined them, check again</Button>
                    </div>
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
                            <td className="p-2 whitespace-nowrap">
                              {data.semester || "-"}
                              {(() => {
                                const landed = local.rows.find((x) => x.rowNumber === rowNumber)?.semester;
                                return landed != null && String(landed) !== String(data.semester).trim() ? <span className="text-muted-foreground"> (Sem {landed})</span> : null;
                              })()}
                            </td>
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
