"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { resolveDepartmentByNameOrCode, resolveCourseByNameOrCode } from "@/lib/departments/codeOrNameResolver";
import { resolveSubjectCategory, resolveSubjectType } from "@/lib/subjects/normalize";
import type { Course, CourseCatalogItem, Department, Subject, SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS, SUBJECT_TYPE_LABELS } from "@/types";
import { recentAcademicSessions, parseAcademicYearStart } from "@/lib/college/academicSession";
import { resolveDepartmentCourseScope, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { stripLeadingZeros } from "@/lib/utils";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, Pencil } from "lucide-react";

// Department/Course/Academic Year/Year come from a specific course-year's own
// "Import Subjects" shortcut (see dean/subjects/page.tsx) - when present,
// every row in the file belongs to that one context, so those 4 columns are
// hidden from the template/preview and force-injected into every row
// instead, same LOCKED_KEYS convention as the student roster importer
// (college-office/students/import/page.tsx).
const LOCKED_KEYS = ["department", "course", "academicYear", "year"];

type ParsedRow = Record<string, string>;
type ImportResult = {
  created: number;
  failed: { row: number; code: string; error: string }[];
  warnings: { row: number; code: string; warning: string }[];
};
// A skipped row plus its own original field values (snapshotted from `rows`
// before it's cleared on partial success) and the row's live status: "failed"
// until fixed and retried, then "fixed" (kept in the list, struck through,
// rather than vanishing) - same pattern as the student roster importer's own
// fix-and-retry flow.
type FailedRow = { row: number; code: string; error: string; data: ParsedRow; status: "failed" | "fixed" };

type FixForm = {
  departmentId: string;
  courseId: string;
  academicYear: string;
  year: string;
  regulation: string;
  serialNumber: string;
  category: SubjectCategory | "";
  customCategory: string;
  name: string;
  code: string;
  type: SubjectType;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  hoursPerWeek: string;
  totalHoursPerSemester: string;
  credits: string;
};

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function ImportDeanSubjectsPage() {
  const searchParams = useSearchParams();
  const lockedDepartmentId = searchParams.get("departmentId") ?? "";
  const lockedCourseId = searchParams.get("courseId") ?? "";
  const lockedYear = searchParams.get("year") ?? "";
  const lockedDepartment = searchParams.get("department") ?? "";
  const lockedCourseName = searchParams.get("courseName") ?? "";
  const lockedAcademicYear = searchParams.get("academicYear") ?? "";
  const isLocked = !!(lockedDepartmentId && lockedCourseId && lockedYear && lockedDepartment && lockedCourseName && lockedAcademicYear);

  const backHref = isLocked
    ? `/dean/subjects?departmentId=${lockedDepartmentId}&courseId=${lockedCourseId}&year=${lockedYear}&academicYear=${encodeURIComponent(lockedAcademicYear)}`
    : "/dean/subjects";

  const columns = useMemo(
    () => (isLocked ? IMPORT_COLUMNS.filter((c) => !LOCKED_KEYS.includes(c.key)) : IMPORT_COLUMNS),
    [isLocked]
  );

  // Loaded once, used both for the locked context's template S.No. sample and
  // for the "fix this row" dialog's Department/Course/Regulation pickers.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>).catch(() => ({ departments: [] })),
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
      fetch("/api/college/course-catalog").then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>).catch(() => ({ items: [] })),
    ]).then(([d, c, cat]) => {
      setDepartments(d.departments ?? []);
      setCourses((c.courses ?? []).filter((x) => x.isActive));
      setCatalogItems(cat.items ?? []);
    }).catch(() => { /* non-critical - the fix dialog just falls back to fewer options */ });
  }, []);

  // Only meaningful in locked mode - so the downloaded template's sample
  // S.No. continues from this year's existing subjects instead of always
  // starting at 1.
  const [nextSerialNumber, setNextSerialNumber] = useState(1);
  useEffect(() => {
    if (!isLocked) return;
    fetch(`/api/college/subjects?department=${encodeURIComponent(lockedDepartment)}&courseId=${encodeURIComponent(lockedCourseId)}&year=${encodeURIComponent(lockedYear)}&academicYear=${encodeURIComponent(lockedAcademicYear)}`)
      .then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
      .then((d) => {
        const subs = (d.subjects ?? []).filter((s) => s.department === lockedDepartment);
        setNextSerialNumber(Math.max(0, ...subs.map((s) => s.serialNumber ?? 0)) + 1);
      })
      .catch(() => {});
  }, [isLocked, lockedDepartment, lockedCourseId, lockedYear, lockedAcademicYear]);

  // ── Steps 1-4: Download Template / Upload / Preview / Import ───────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);

  function downloadTemplate() {
    const headers = columns.map((c) => c.label);
    const sample1 = columns.map((c) => (c.key === "serialNumber" ? String(nextSerialNumber) : c.sample));
    downloadCSV(toCSV([headers, sample1]), "subjects_import_template.csv");
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
      const keyMap = matchHeaders(headers, columns);

      const mappedCount = Object.keys(keyMap).length;
      if (mappedCount === 0) {
        setParseError("None of the columns in this file matched the template. Make sure the header row is the first row, and its wording is close to the template.");
        return;
      }
      if (!Object.values(keyMap).includes("name") && !Object.values(keyMap).includes("code")) {
        setParseError("Couldn't find a \"Name of the Subject\" or \"Code\" column. Check your file's header row against the template.");
        return;
      }
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
      }).filter((r) => Object.values(r).some((v) => v.trim()));

      if (dataRows.length === 0) { setParseError("No data rows found after the header - check that your data starts on the row right after the header, with no blank rows in between."); return; }
      if (dataRows.length > 300) { setParseError("Maximum 300 rows allowed per import."); return; }

      setRows(dataRows);
    } catch {
      setParseError(isExcel ? "Failed to parse the Excel file. Ensure it is a valid, uncorrupted .xlsx file." : "Failed to parse the file. Ensure it is a valid CSV.");
    } finally {
      e.target.value = "";
    }
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setIsImporting(true);
    setResult(null);
    setFailedRows([]);
    try {
      const records = rows.map((r) => ({
        ...r,
        ...(isLocked ? { department: lockedDepartment, course: lockedCourseName, academicYear: lockedAcademicYear, year: lockedYear } : {}),
      }));
      const res = await fetch("/api/college/subjects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Import failed" }); return; }
      setResult(json);
      // Snapshot each failed row's own original values before `rows` is
      // cleared below (on any partial success) - the "fix and retry" dialog
      // needs them, and this is the only place they still exist.
      setFailedRows(json.failed.map((f) => ({ ...f, data: rows[f.row - 2] ?? {}, status: "failed" as const })));
      if (json.created > 0) {
        toast({ variant: "success", title: `${json.created} subject${json.created !== 1 ? "s" : ""} imported successfully` });
        setRows([]);
        if (isLocked) {
          fetch(`/api/college/subjects?department=${encodeURIComponent(lockedDepartment)}&courseId=${encodeURIComponent(lockedCourseId)}&year=${encodeURIComponent(lockedYear)}&academicYear=${encodeURIComponent(lockedAcademicYear)}`)
            .then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
            .then((d) => {
              const subs = (d.subjects ?? []).filter((s) => s.department === lockedDepartment);
              setNextSerialNumber(Math.max(0, ...subs.map((s) => s.serialNumber ?? 0)) + 1);
            })
            .catch(() => {});
        }
      }
    } catch {
      toast({ variant: "destructive", title: "Network error - import failed" });
    } finally {
      setIsImporting(false);
    }
  }

  // ── Failed-row "fix and retry" dialog - reuses the single-subject create
  // endpoint (POST /api/college/subjects, the same one Add Subject uses), so
  // a corrected row is created identically to a manual add and goes through
  // that route's own regulation/department validation. ───────────────────────
  const [fixTarget, setFixTarget] = useState<{ row: number; form: FixForm } | null>(null);
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState("");

  function openFix(f: FailedRow) {
    const deptNameRaw = isLocked ? lockedDepartment : (f.data.department ?? "");
    const courseNameRaw = isLocked ? lockedCourseName : (f.data.course ?? "");
    // Best-effort pre-resolve: a short code (or a genuinely wrong value)
    // won't match any real name, in which case the Select is simply left
    // blank for the Dean to pick correctly - same as a fresh Add.
    const resolvedDeptName = resolveDepartmentByNameOrCode(departments, deptNameRaw) ?? "";
    const departmentId = departments.find((d) => d.name === resolvedDeptName)?.id ?? "";
    const resolvedCourseName = departmentId ? (resolveCourseByNameOrCode(courses, departmentId, courseNameRaw) ?? "") : "";
    const courseId = departmentId ? (courses.find((c) => c.departmentId === departmentId && c.name === resolvedCourseName)?.id ?? "") : "";
    const form: FixForm = {
      departmentId,
      courseId,
      academicYear: isLocked ? lockedAcademicYear : (f.data.academicYear ?? ""),
      year: isLocked ? lockedYear : (f.data.year ?? ""),
      regulation: f.data.regulation?.trim() ?? "",
      serialNumber: f.data.serialNumber ?? "",
      category: resolveSubjectCategory(f.data.category) ?? "",
      customCategory: f.data.customCategory ?? "",
      name: f.data.name ?? "",
      code: f.data.code ?? "",
      type: resolveSubjectType(f.data.type) ?? "THEORY",
      lectureHours: f.data.lectureHours ?? "",
      tutorialHours: f.data.tutorialHours ?? "",
      practicalHours: f.data.practicalHours ?? "",
      hoursPerWeek: f.data.hoursPerWeek ?? "",
      totalHoursPerSemester: f.data.totalHoursPerSemester ?? "",
      credits: f.data.credits ?? "",
    };
    setFixError("");
    setFixTarget({ row: f.row, form });
  }

  function setFixField<K extends keyof FixForm>(key: K, value: FixForm[K]) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));
  }

  function fixSelectDepartment(departmentId: string) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, departmentId, courseId: "", year: "", regulation: "" } } : prev));
  }

  function fixSelectCourse(courseId: string) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, courseId, year: "", regulation: "" } } : prev));
  }

  function fixSelectYear(year: string) {
    setFixTarget((prev) => (prev ? { ...prev, form: { ...prev.form, year, regulation: "" } } : prev));
  }

  const fixSelectedDept = useMemo(
    () => departments.find((d) => d.id === fixTarget?.form.departmentId) ?? null,
    [departments, fixTarget?.form.departmentId]
  );
  const fixDeptCourses = useMemo(
    () => courses.filter((c) => c.departmentId === fixTarget?.form.departmentId),
    [courses, fixTarget?.form.departmentId]
  );
  const fixSelectedCourse = useMemo(
    () => fixDeptCourses.find((c) => c.id === fixTarget?.form.courseId) ?? null,
    [fixDeptCourses, fixTarget?.form.courseId]
  );
  const fixYearOptions = useMemo(() => {
    if (!fixSelectedCourse || !fixSelectedDept) return [];
    const courseYears = Array.from({ length: fixSelectedCourse.durationYears }, (_, i) => i + 1);
    const assigned = resolveDepartmentCourseScope(fixSelectedDept, fixSelectedCourse.catalogId).assignedYears;
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  }, [fixSelectedCourse, fixSelectedDept]);
  const fixCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === fixSelectedCourse?.catalogId) ?? null,
    [catalogItems, fixSelectedCourse]
  );
  const fixYear = fixTarget?.form.year ?? "";
  const fixAcademicYear = fixTarget?.form.academicYear ?? "";
  const fixAllowedRegulations = useMemo(() => {
    if (!fixYear) return [];
    return regulationsForCourseYearByBatch(
      fixCatalogItem?.regulationBatches ?? {},
      Number(fixYear),
      parseAcademicYearStart(fixAcademicYear) ?? undefined,
      fixCatalogItem?.regulations,
    );
  }, [fixCatalogItem, fixYear, fixAcademicYear]);
  const fixAcademicYearOptions = useMemo(() => {
    const base = recentAcademicSessions();
    const cur = fixAcademicYear;
    return cur && !base.includes(cur) ? [cur, ...base] : base;
  }, [fixAcademicYear]);

  async function handleFixSave() {
    if (!fixTarget) return;
    const form = fixTarget.form;
    const dept = departments.find((d) => d.id === form.departmentId);
    const course = courses.find((c) => c.id === form.courseId);
    if (!dept) { setFixError("Department is required"); return; }
    if (!course) { setFixError("Course is required"); return; }
    if (!form.year) { setFixError("Year is required"); return; }
    if (!form.academicYear) { setFixError("Academic Year is required"); return; }
    if (!form.name.trim() || !form.code.trim()) { setFixError("Name and code are required"); return; }
    if (form.serialNumber === "") { setFixError("S.No. is required"); return; }
    if (!form.category) { setFixError("Select a category"); return; }
    if (form.category === "OTHER" && !form.customCategory.trim()) { setFixError("Enter a name for the custom category"); return; }
    if (form.lectureHours === "" || form.tutorialHours === "" || form.practicalHours === "") { setFixError("L, T and P are required"); return; }
    setFixSaving(true);
    setFixError("");
    try {
      const res = await fetch("/api/college/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: form.courseId,
          year: Number(form.year),
          department: dept.name,
          academicYear: form.academicYear,
          regulation: form.regulation || undefined,
          serialNumber: Number(form.serialNumber),
          category: form.category,
          customCategory: form.category === "OTHER" ? form.customCategory.trim() : undefined,
          name: form.name.trim(),
          code: form.code.trim(),
          type: form.type,
          lectureHours: Number(form.lectureHours),
          tutorialHours: Number(form.tutorialHours),
          practicalHours: Number(form.practicalHours),
          hoursPerWeek: form.hoursPerWeek === "" ? 0 : Number(form.hoursPerWeek),
          totalHoursPerSemester: form.totalHoursPerSemester === "" ? null : Number(form.totalHoursPerSemester),
          credits: form.credits === "" ? 0 : Number(form.credits),
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) { setFixError(json.error ?? "Failed to save"); return; }
      toast({ variant: "success", title: `${form.name.trim()} imported` });
      setFailedRows((prev) => prev.map((r) => (r.row === fixTarget.row ? { ...r, status: "fixed" as const } : r)));
      setFixTarget(null);
    } catch {
      setFixError("Network error - please try again");
    } finally {
      setFixSaving(false);
    }
  }

  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);
  const missingRequired = rows.length > 0
    ? rows.some((r) => requiredKeys.some((k) => !r[k]?.trim()))
    : false;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Import Subjects"
        description={isLocked
          ? `Bulk upload subjects for ${lockedDepartment} · ${lockedCourseName} · ${ordinalYear(Number(lockedYear))} · ${lockedAcademicYear}`
          : "Bulk upload subjects from a CSV file - a single file may cover multiple departments, courses and years"}
        actions={
          <Button variant="outline" asChild>
            <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-1" />Back to Subjects</Link>
          </Button>
        }
      />

      {/* Step 1: Download Template */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>Download Template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download the CSV template, fill in the subjects, and upload it below. Each row is one subject.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            {HINTS.filter((h) => !isLocked || !h.startsWith("A single file")).map((h) => (
              <p key={h} className="flex items-start gap-1"><span className="text-primary mt-0.5">•</span>{h}</p>
            ))}
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
              <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx supported - headers matched loosely</p>
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
                    {columns.filter((c) => rows.some((r) => r[c.key])).map((c) => (
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
                        {columns.filter((c) => rows.some((r) => r[c.key])).map((c) => (
                          <td key={c.key} className={`p-2 whitespace-nowrap ${c.required && !row[c.key]?.trim() ? "text-red-600 font-medium" : ""}`}>
                            {row[c.key] || <span className="text-muted-foreground/40">-</span>}
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
              {(result.created > 0 || fixed.length > 0) && (
                <Button asChild variant="outline" size="sm">
                  <Link href={backHref}>View Subjects List</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Dialog open={!!fixTarget} onOpenChange={(o) => !o && setFixTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fix Row {fixTarget?.row}</DialogTitle>
            <DialogDescription>
              Correct the field(s) that failed and save - this imports just this one subject, the same as adding one manually.
            </DialogDescription>
          </DialogHeader>

          {fixTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select value={fixTarget.form.departmentId} onValueChange={fixSelectDepartment}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Course</Label>
                  <Select value={fixTarget.form.courseId} onValueChange={fixSelectCourse} disabled={!fixTarget.form.departmentId}>
                    <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                    <SelectContent>
                      {fixDeptCourses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Academic Year</Label>
                  <Select value={fixTarget.form.academicYear} onValueChange={(v) => setFixField("academicYear", v)}>
                    <SelectTrigger><SelectValue placeholder="Select academic year" /></SelectTrigger>
                    <SelectContent>
                      {fixAcademicYearOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Year</Label>
                  <Select value={fixTarget.form.year} onValueChange={fixSelectYear} disabled={!fixTarget.form.courseId}>
                    <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                    <SelectContent>
                      {fixYearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Regulation</Label>
                <Select value={fixTarget.form.regulation} onValueChange={(v) => setFixField("regulation", v)} disabled={fixAllowedRegulations.length === 0}>
                  <SelectTrigger><SelectValue placeholder={fixAllowedRegulations.length ? "Select regulation (optional)" : "None resolved for this year"} /></SelectTrigger>
                  <SelectContent>
                    {fixAllowedRegulations.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>S.No.</Label>
                  <Input
                    type="number"
                    min={0}
                    value={fixTarget.form.serialNumber}
                    onChange={(e) => setFixField("serialNumber", stripLeadingZeros(e.target.value))}
                  />
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
                  {fixTarget.form.category === "OTHER" && (
                    <Input
                      value={fixTarget.form.customCategory}
                      onChange={(e) => setFixField("customCategory", e.target.value)}
                      placeholder="Enter category name"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Name of the Subject</Label>
                <Input value={fixTarget.form.name} onChange={(e) => setFixField("name", e.target.value)} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Code</Label>
                  <Input value={fixTarget.form.code} onChange={(e) => setFixField("code", e.target.value.toUpperCase())} className="uppercase" />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={fixTarget.form.type} onValueChange={(v) => setFixField("type", v as SubjectType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SUBJECT_TYPE_LABELS) as [SubjectType, string][]).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Label>Hours / Week</Label>
                  <Input type="number" min={0} value={fixTarget.form.hoursPerWeek} onChange={(e) => setFixField("hoursPerWeek", stripLeadingZeros(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>Hours / Semester</Label>
                  <Input type="number" min={0} value={fixTarget.form.totalHoursPerSemester} onChange={(e) => setFixField("totalHoursPerSemester", stripLeadingZeros(e.target.value))} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Credits</Label>
                  <Input type="number" min={0} step="any" value={fixTarget.form.credits} onChange={(e) => setFixField("credits", stripLeadingZeros(e.target.value))} />
                </div>
              </div>
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
