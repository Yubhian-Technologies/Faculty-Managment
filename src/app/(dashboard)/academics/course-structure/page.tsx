"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { toCSV, parseCSV, downloadCSV, matchHeaders, getUnmatchedHeaders, parseExcelFile, readFileAsText } from "@/lib/utils/csv";
import { IMPORT_COLUMNS, IMPORT_HINTS as HINTS } from "@/lib/subjects/csvColumns";
import { resolveSubjectCategory } from "@/lib/subjects/normalize";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { teachableYearsForDepartment } from "@/lib/subjects/teachableYears";
import { stripLeadingZeros } from "@/lib/utils";
import type { CourseYearTiming, SubjectCategory } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, Pencil, BookOpen, Layers } from "lucide-react";

type ParsedRow = Record<string, string>;
type ImportResult = {
  created: number;
  assigned: number;
  failed: { row: number; code: string; error: string; stage: "create" | "assign" }[];
  warnings: { row: number; code: string; warning: string }[];
};
// Same fix-and-retry pattern as the old academics/subjects/import/page.tsx -
// a skipped row plus its own original field values (snapshotted before
// `rows` clears on partial success) and a live status.
// "scope" = excluded BEFORE submit (Year/Semester validation - see
// validateRowScope) - never even sent to the server, unlike "create"/
// "assign" which are the server's own post-submit failure stages.
type FailedRow = { row: number; code: string; error: string; stage: "create" | "assign" | "scope"; data: ParsedRow; status: "failed" | "fixed" };

type FixForm = {
  category: SubjectCategory | "";
  name: string;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  internalMarks: string;
  externalMarks: string;
  totalMarks: string;
  credits: string;
  shortCode: string;
  year: string;
  semester: string;
};

export default function CourseStructurePage() {
  return (
    <Suspense fallback={null}>
      <CourseStructurePageInner />
    </Suspense>
  );
}

function CourseStructurePageInner() {
  const picker = useRegulationCourseDepartmentPicker();
  const searchParams = useSearchParams();

  // Deep-link prefill from principal/departments/[id]/page.tsx's per-year
  // "Sem N: K subjects" status badges (?catalogId=&departmentId=&year=&
  // semester=) - lands the admin straight on the right Course+Department
  // instead of re-walking the cascade by hand. Year/semester aren't
  // consumed here (Course Structure gets those per uploaded row, not a
  // dropdown) - only Regulation/Course/Department are prefilled.
  const prefillRef = useRef<{ catalogId: string; departmentId: string } | null>(null);
  const [prefillPending, setPrefillPending] = useState(false);
  useEffect(() => {
    const catalogId = searchParams.get("catalogId");
    const departmentId = searchParams.get("departmentId");
    if (catalogId && departmentId) {
      prefillRef.current = { catalogId, departmentId };
      setPrefillPending(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!prefillPending || picker.catalogItems.length === 0) return;
    const p = prefillRef.current;
    const item = p ? picker.catalogItems.find((c) => c.id === p.catalogId) : null;
    if (!p || !item) { setPrefillPending(false); return; }
    picker.setSelectedRegulation(item.regulations?.[0] ?? "");
    picker.setSelectedCatalogId(p.catalogId);
    picker.selectDepartment(p.departmentId);
    setPrefillPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPending, picker.catalogItems]);

  // ── Pre-import validation: does the SELECTED department actually teach
  // each row's Year, and is that Year/Semester configured in Course-Year
  // Timings at all? Checked here, before anything is sent to the server,
  // so a bad row is caught and excluded up front rather than round-tripped
  // through a create-then-fail cycle (the server still re-checks this on
  // submit too - see CourseStructureImportService - this is purely to
  // surface it earlier, in the Preview, not a replacement for that check).
  const [courseYearTimings, setCourseYearTimings] = useState<CourseYearTiming[]>([]);
  useEffect(() => {
    if (!picker.selectedCourse) { setCourseYearTimings([]); return; }
    fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(picker.selectedCourse.id)}`)
      .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
      .then((d) => setCourseYearTimings(d.timings ?? []))
      .catch(() => setCourseYearTimings([]));
  }, [picker.selectedCourse]);

  const teachableYears = useMemo(() => {
    if (!picker.selectedCourse || !picker.selectedDepartment) return new Set<number>();
    return new Set(teachableYearsForDepartment(picker.selectedCourse, picker.selectedDepartment, picker.allDepartments));
  }, [picker.selectedCourse, picker.selectedDepartment, picker.allDepartments]);

  // Returns null when the row's Year/Semester are fine to import, or a
  // human-readable reason when they're not - either because this
  // department isn't scoped to teach that Year at all, or because
  // Course-Year Timings has no such Year/Semester configured for this
  // course (so SubjectInstanceService would reject the assignment even if
  // department scope were fine).
  function validateRowScope(row: ParsedRow): string | null {
    const yearRaw = row.year?.trim();
    const semesterRaw = row.semester?.trim();
    if (!yearRaw || !semesterRaw) return null; // caught separately as a missing-required-field row
    const year = Number(yearRaw);
    const semester = Number(semesterRaw);
    if (!Number.isFinite(year) || !Number.isFinite(semester)) return null; // same - non-numeric is a required-field-style error, not a scope one

    if (!teachableYears.has(year)) {
      return `${picker.selectedDepartment?.name ?? "This department"} isn't assigned to teach Year ${year} of this course.`;
    }
    const timing = courseYearTimings.find((t) => t.year === year);
    if (!timing || !(timing.semesters ?? []).some((s) => s.semester === semester)) {
      return `Year ${year} / Semester ${semester} isn't configured in Course-Year Timings for this course.`;
    }
    return null;
  }

  // ── Step 1-4: Download Template / Upload / Preview / Import ─────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [parseWarning, setParseWarning] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);

  const canUpload = !!picker.selectedCourse && !!picker.selectedDepartmentId;

  function resetUploadState() {
    setRows([]);
    setParseError("");
    setParseWarning("");
    setResult(null);
    setFailedRows([]);
  }

  function downloadTemplate() {
    const headers = IMPORT_COLUMNS.map((c) => c.label);
    const sample1 = IMPORT_COLUMNS.map((c) => c.sample);
    const prefix = picker.selectedCourse ? picker.selectedCourse.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "course_structure";
    downloadCSV(toCSV([headers, sample1]), `${prefix}_import_template.csv`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resetUploadState();

    if (!canUpload) {
      setParseError("Select Regulation, Course and Department above before uploading.");
      e.target.value = "";
      return;
    }

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
      const keyMap = matchHeaders(headers, IMPORT_COLUMNS);

      const mappedCount = Object.keys(keyMap).length;
      if (mappedCount === 0) {
        setParseError("None of the columns in this file matched the template. Make sure the header row is the first row, and its wording is close to the template.");
        return;
      }
      if (!Object.values(keyMap).includes("name")) {
        setParseError("Couldn't find a \"Subject Name\" column. Check your file's header row against the template.");
        return;
      }
      const unmatched = getUnmatchedHeaders(headers, keyMap);
      if (unmatched.length > 0) {
        setParseWarning(`These column(s) don't match any template column and were ignored: ${unmatched.map((h) => `"${h}"`).join(", ")}.`);
      }

      const dataRows = parsed.slice(1).map((cells) => {
        const row: ParsedRow = {};
        cells.forEach((val, i) => {
          if (keyMap[i]) row[keyMap[i]] = val;
        });
        return row;
      }).filter((r) => Object.values(r).some((v) => v.trim()));

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
    if (rows.length === 0 || !picker.selectedCourse || !picker.selectedDepartmentId) return;
    setIsImporting(true);
    setResult(null);

    // Rows that fail Year/Semester scope validation are excluded from the
    // request entirely (per the "validate before importing, don't import
    // them" requirement) - only rows that pass every check are sent.
    // originalRowNumbers keeps each SENT row's true position in the parsed
    // file, since the server numbers its own failed[]/warnings[] by
    // position within whatever array it actually received, not the
    // original file - without this translation, "Row N" in the results
    // would point at the wrong row whenever any rows were excluded above it.
    const entries = rows.map((row, i) => ({ row, originalRowNumber: i + 2, verdict: rowVerdicts[i] }));
    const scopeExcluded: FailedRow[] = entries
      .filter((e) => !e.verdict.importable && e.verdict.reason != null)
      .map((e) => ({ row: e.originalRowNumber, code: e.row.code || "-", error: e.verdict.reason!, stage: "scope" as const, data: e.row, status: "failed" as const }));
    const toSend = entries.filter((e) => e.verdict.importable);
    const originalRowNumbers = toSend.map((e) => e.originalRowNumber);
    const records = toSend.map((e) => e.row);

    if (records.length === 0) {
      setIsImporting(false);
      setFailedRows(scopeExcluded);
      toast({ variant: "destructive", title: "Every row failed Year/Semester validation - nothing was imported" });
      return;
    }

    try {
      const res = await fetch("/api/college/subjects/import-and-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: picker.selectedCourse.id,
          departmentId: picker.selectedDepartmentId,
          departmentName: picker.selectedDepartment?.name,
          regulation: picker.selectedRegulation || undefined,
          records,
        }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      // Translate each failure's sent-array position back to its original
      // file row number before snapshotting its own values, then merge in
      // the rows that were excluded before submit at all.
      const serverFailed = json.failed.map((f) => {
        const originalRow = originalRowNumbers[f.row - 2] ?? f.row;
        return { ...f, row: originalRow, data: rows[originalRow - 2] ?? {}, status: "failed" as const };
      });
      setFailedRows([...scopeExcluded, ...serverFailed]);
      if (json.assigned > 0) {
        toast({ variant: "success", title: `${json.assigned} subject${json.assigned !== 1 ? "s" : ""} created and assigned` });
        setRows([]);
      }
      if (scopeExcluded.length > 0) {
        toast({ variant: "destructive", title: `${scopeExcluded.length} row${scopeExcluded.length !== 1 ? "s" : ""} skipped - Year/Semester not assigned to this department` });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error - import failed" });
    } finally {
      setIsImporting(false);
    }
  }

  // ── Failed-row "fix and retry" dialog - resubmits just this one row
  // through the same combined create+assign endpoint. ──────────────────────
  const [fixTarget, setFixTarget] = useState<{ row: number; form: FixForm } | null>(null);
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState("");

  function openFix(f: FailedRow) {
    const form: FixForm = {
      category: resolveSubjectCategory(f.data.category) ?? "",
      name: f.data.name ?? "",
      lectureHours: f.data.lectureHours ?? "",
      tutorialHours: f.data.tutorialHours ?? "",
      practicalHours: f.data.practicalHours ?? "",
      internalMarks: f.data.internalMarks ?? "",
      externalMarks: f.data.externalMarks ?? "",
      totalMarks: f.data.totalMarks ?? "",
      credits: f.data.credits ?? "",
      shortCode: f.data.shortCode ?? "",
      year: f.data.year ?? "",
      semester: f.data.semester ?? "",
    };
    setFixError("");
    setFixTarget({ row: f.row, form });
  }

  function setFixField<K extends keyof FixForm>(key: K, value: FixForm[K]) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));
  }

  const fixHoursPerWeek = fixTarget
    ? (Number(fixTarget.form.lectureHours) || 0) + (Number(fixTarget.form.tutorialHours) || 0) + (Number(fixTarget.form.practicalHours) || 0)
    : 0;

  async function handleFixSave() {
    if (!fixTarget || !picker.selectedCourse || !picker.selectedDepartmentId) return;
    const form = fixTarget.form;
    if (!form.name.trim()) { setFixError("Subject Name is required"); return; }
    if (!form.category) { setFixError("Select a category"); return; }
    if (form.lectureHours === "" || form.tutorialHours === "" || form.practicalHours === "") { setFixError("L, T and P are required"); return; }
    if (!form.year || !form.semester) { setFixError("Year and Semester are required"); return; }
    setFixSaving(true);
    setFixError("");
    try {
      const originalCode = failedRows.find((r) => r.row === fixTarget.row)?.code;
      const res = await fetch("/api/college/subjects/import-and-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: picker.selectedCourse.id,
          departmentId: picker.selectedDepartmentId,
          departmentName: picker.selectedDepartment?.name,
          regulation: picker.selectedRegulation || undefined,
          records: [{
            serialNumber: 1,
            category: form.category,
            name: form.name.trim(),
            code: originalCode && originalCode !== "-" ? originalCode : form.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10),
            shortCode: form.shortCode || undefined,
            lectureHours: form.lectureHours,
            tutorialHours: form.tutorialHours,
            practicalHours: form.practicalHours,
            internalMarks: form.internalMarks || undefined,
            externalMarks: form.externalMarks || undefined,
            totalMarks: form.totalMarks || undefined,
            credits: form.credits || undefined,
            year: form.year,
            semester: form.semester,
          }],
        }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { setFixError(json.error ?? "Failed to save"); return; }
      if (json.failed.length > 0) { setFixError(json.failed[0].error); return; }
      toast({ variant: "success", title: `${form.name.trim()} created and assigned` });
      setFailedRows((prev) => prev.map((r) => (r.row === fixTarget.row ? { ...r, status: "fixed" as const } : r)));
      setFixTarget(null);
    } catch {
      setFixError("Network error - please try again");
    } finally {
      setFixSaving(false);
    }
  }

  const requiredKeys = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
  function rowMissingRequired(row: ParsedRow): boolean {
    return requiredKeys.some((k) => !row[k]?.trim());
  }
  const missingRequired = rows.some(rowMissingRequired);

  // Every row's own verdict, computed once and reused by the Preview table,
  // the Step 4 summary/button, and the actual submit payload - a row is
  // importable only when it has every required field AND passes the
  // Year/Semester scope check above.
  const rowVerdicts = useMemo(
    () => rows.map((row) => {
      if (rowMissingRequired(row)) return { row, importable: false, reason: null as string | null };
      const scopeError = validateRowScope(row);
      return { row, importable: !scopeError, reason: scopeError };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, teachableYears, courseYearTimings]
  );
  const importableRows = rowVerdicts.filter((v) => v.importable).map((v) => v.row);
  const scopeInvalidCount = rowVerdicts.filter((v) => !v.importable && v.reason != null).length;

  const stillFailed = failedRows.filter((f) => f.status === "failed");
  const fixed = failedRows.filter((f) => f.status === "fixed");

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Course Structure"
        description="Upload a course's subjects once - they're created and auto-assigned to the selected department's semesters, no separate Assign to Semester step."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

      <Card className="border-primary/20 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Regulation, Course &amp; Department</span>
            {picker.selectedCourse && picker.selectedDepartment && (
              <Badge variant="secondary" className="font-mono text-xs">{picker.selectedDepartment.name}</Badge>
            )}
          </CardTitle>
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
            <Select
              value={picker.selectedCatalogId}
              onValueChange={(v) => { picker.selectCatalog(v); resetUploadState(); }}
              disabled={!picker.selectedRegulation}
            >
              <SelectTrigger><SelectValue placeholder={!picker.selectedRegulation ? "Select a regulation first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {picker.catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select
              value={picker.selectedDepartmentId}
              onValueChange={(v) => { picker.selectDepartment(v); resetUploadState(); }}
              disabled={!picker.selectedCatalogId}
            >
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
      </Card>

      {canUpload && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>Download Template</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Download the template, fill in every subject for {picker.selectedDepartment?.name}, and upload it below. Each row is one subject.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                {HINTS.map((h) => (
                  <p key={h} className="flex items-start gap-1"><span className="text-primary mt-0.5">•</span>{h}</p>
                ))}
              </div>
              <Button onClick={downloadTemplate} className="gap-2"><Download className="h-4 w-4" />Download Template (CSV)</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>Upload Filled File</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void handleFile(e)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer"
                aria-label="Click to upload CSV or Excel file"
              >
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium text-sm">Click to select a CSV or Excel file</p>
                  <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx supported - headers matched loosely</p>
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
              {rows.length > 0 && (
                <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1">
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
                    <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                    Preview ({rows.length} records)
                  </CardTitle>
                  <div className="flex gap-2">
                    {missingRequired && <Badge variant="destructive" className="text-xs">Missing required fields</Badge>}
                    {scopeInvalidCount > 0 && <Badge variant="destructive" className="text-xs">{scopeInvalidCount} not assigned to this department</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left p-2 font-medium text-muted-foreground w-8">#</th>
                        {IMPORT_COLUMNS.filter((c) => rows.some((r) => r[c.key])).map((c) => (
                          <th key={c.key} className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">
                            {c.label}{c.required && <span className="text-red-500 ml-0.5">*</span>}
                          </th>
                        ))}
                        <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((row, i) => {
                        const missing = rowMissingRequired(row);
                        const verdict = rowVerdicts[i];
                        const scopeError = !missing ? verdict?.reason : null;
                        return (
                          <tr key={i} className={`border-b ${missing || scopeError ? "bg-red-50 dark:bg-destructive/15" : i % 2 === 0 ? "" : "bg-muted/20"}`}>
                            <td className="p-2 text-muted-foreground">{i + 2}</td>
                            {IMPORT_COLUMNS.filter((c) => rows.some((r) => r[c.key])).map((c) => (
                              <td
                                key={c.key}
                                className={`p-2 whitespace-nowrap ${
                                  (c.required && !row[c.key]?.trim()) || ((c.key === "year" || c.key === "semester") && scopeError)
                                    ? "text-red-600 font-medium"
                                    : ""
                                }`}
                              >
                                {row[c.key] || <span className="text-muted-foreground/40">-</span>}
                              </td>
                            ))}
                            <td className="p-2 whitespace-nowrap">
                              {missing ? (
                                <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3 shrink-0" />Missing field(s)</span>
                              ) : scopeError ? (
                                <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3 shrink-0" />{scopeError}</span>
                              ) : (
                                <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3 shrink-0" />OK</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {rows.length > 20 && (
                    <p className="text-xs text-muted-foreground p-3 border-t">Showing first 20 of {rows.length} rows.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {rows.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>Create &amp; Assign</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {missingRequired && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />Some rows have missing required fields (highlighted in red above). Those rows will be skipped.
                  </div>
                )}
                {scopeInvalidCount > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-destructive/10 border border-red-200 dark:border-destructive/20 text-red-700 dark:text-red-400 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {scopeInvalidCount} row{scopeInvalidCount !== 1 ? "s" : ""} won&apos;t be imported - their Year/Semester isn&apos;t assigned to {picker.selectedDepartment?.name} or isn&apos;t configured in Course-Year Timings (see Status column above). Fix the file and re-upload, or import the rest now and fix these individually afterward.
                  </div>
                )}
                <div className="flex gap-3">
                  <Button onClick={() => void handleImport()} loading={isImporting} disabled={isImporting || importableRows.length === 0}>
                    <Upload className="h-4 w-4 mr-2" />
                    Create &amp; Assign {importableRows.length}{importableRows.length !== rows.length ? ` of ${rows.length}` : ""} Record{importableRows.length !== 1 ? "s" : ""}
                  </Button>
                  <Button variant="outline" onClick={resetUploadState}>Clear</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {result && (
            <Card className={result.assigned > 0 || fixed.length > 0 ? "border-green-200" : "border-red-200"}>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  {result.assigned > 0 ? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" /> : <XCircle className="h-6 w-6 text-red-600 shrink-0" />}
                  <div>
                    <p className="font-semibold flex items-center gap-1.5"><Layers className="h-4 w-4" />{result.created} created · {result.assigned} assigned to {picker.selectedDepartment?.name}</p>
                    {failedRows.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {stillFailed.length} row{stillFailed.length !== 1 ? "s" : ""} skipped{fixed.length > 0 ? ` · ${fixed.length} fixed just now` : ""}
                      </p>
                    )}
                    {result.warnings.length > 0 && (
                      <p className="text-sm text-amber-700">{result.warnings.length} field{result.warnings.length !== 1 ? "s" : ""} ignored due to invalid values</p>
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
                            <span className="text-muted-foreground">Row {f.row} · {f.data.name || f.code}</span>
                            <Badge variant="outline" className="ml-2 text-[10px] py-0">
                              {f.stage === "create" ? "create failed" : f.stage === "assign" ? "assign failed" : "not assigned to department"}
                            </Badge>
                            {f.status === "fixed" ? (
                              <span className="ml-2 text-green-600 text-xs">Fixed and imported</span>
                            ) : (
                              <span className="block text-red-600 text-xs">{f.error}</span>
                            )}
                          </div>
                          {f.status === "failed" && (
                            <button onClick={() => openFix(f)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Edit and retry this row">
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
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Imported, but some fields were ignored</p>
                    <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                      {result.warnings.map((w, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className="text-muted-foreground">Row {w.row} · {w.code}</span>
                          <span className="text-amber-700 text-xs">{w.warning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!fixTarget} onOpenChange={(o) => !o && setFixTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fix Row {fixTarget?.row}</DialogTitle>
            <DialogDescription>Correct the field(s) that failed and save - this creates and assigns just this one subject.</DialogDescription>
          </DialogHeader>

          {fixTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Year</Label>
                  <Input type="number" min={1} value={fixTarget.form.year} onChange={(e) => setFixField("year", stripLeadingZeros(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>Semester</Label>
                  <Input type="number" min={1} value={fixTarget.form.semester} onChange={(e) => setFixField("semester", stripLeadingZeros(e.target.value))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={fixTarget.form.category} onValueChange={(v) => setFixField("category", v as SubjectCategory)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUBJECT_CATEGORY_LABELS) as [SubjectCategory, string][]).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Subject Name</Label>
                  <Input value={fixTarget.form.name} onChange={(e) => setFixField("name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Short Code</Label>
                  <Input value={fixTarget.form.shortCode} onChange={(e) => setFixField("shortCode", e.target.value.toUpperCase())} placeholder="e.g. BCE" className="uppercase" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>L / T / P</Label>
                <div className="grid grid-cols-3 gap-4">
                  <Input type="number" min={0} placeholder="L" aria-label="Lecture hours" value={fixTarget.form.lectureHours} onChange={(e) => setFixField("lectureHours", stripLeadingZeros(e.target.value))} />
                  <Input type="number" min={0} placeholder="T" aria-label="Tutorial hours" value={fixTarget.form.tutorialHours} onChange={(e) => setFixField("tutorialHours", stripLeadingZeros(e.target.value))} />
                  <Input type="number" min={0} placeholder="P" aria-label="Practical hours" value={fixTarget.form.practicalHours} onChange={(e) => setFixField("practicalHours", stripLeadingZeros(e.target.value))} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Weekly Hours</Label>
                  <Input type="number" value={fixHoursPerWeek} disabled />
                  <p className="text-xs text-muted-foreground">L + T + P, computed automatically.</p>
                </div>
                <div className="space-y-2">
                  <Label>Credits</Label>
                  <Input type="number" min={0} step="any" value={fixTarget.form.credits} onChange={(e) => setFixField("credits", stripLeadingZeros(e.target.value))} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Internal Marks</Label>
                  <Input type="number" min={0} value={fixTarget.form.internalMarks} onChange={(e) => setFixField("internalMarks", stripLeadingZeros(e.target.value))} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>External Marks</Label>
                  <Input type="number" min={0} value={fixTarget.form.externalMarks} onChange={(e) => setFixField("externalMarks", stripLeadingZeros(e.target.value))} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Total Marks</Label>
                  <Input type="number" min={0} value={fixTarget.form.totalMarks} onChange={(e) => setFixField("totalMarks", stripLeadingZeros(e.target.value))} placeholder="Optional" />
                </div>
              </div>
            </div>
          )}

          {fixError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{fixError}
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
