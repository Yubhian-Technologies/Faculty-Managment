"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Search, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { parseCSV, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { courseYearNumbers } from "@/lib/college/courseYears";
import { currentTimetableAcademicYear, recentAcademicSessions } from "@/lib/college/academicSession";
import { batchTitle, resolveResultHeaders, RESULT_COLUMNS, type ResultBatchMeta } from "@/lib/examResults/sheet";
import type { FailedResultRow, RawResultRow } from "@/lib/examResults/importRows";
import type { Course, CourseYearTiming, Department, Subject } from "@/types";
import type { ExamResultBatch, ExamResultType } from "@/types/examResults";

// Semester results import: pick the exam, download the template, upload the
// sheet, check it (nothing saved), then save it as a DRAFT the Exam Cell can
// still delete. Publishing happens on the sheet's own page.
//
// With ?batchId= it adds rows to that DRAFT instead (the corrected rows of
// students refused the first time): the exam is the draft's own and locked.

// Rows per request; one student's rows are never split across two requests.
const PART_ROWS = 2500;
const MAX_FILE_ROWS = 60000;

type Summary = { students: number; subjectRows: number; failed: FailedResultRow[]; zeroCreditCodes: string[] };

function partsOf(rows: RawResultRow[]): RawResultRow[][] {
  const byRoll = new Map<string, RawResultRow[]>();
  for (const r of rows) {
    const k = String(r.rollNumber ?? "").trim().toUpperCase();
    byRoll.set(k, [...(byRoll.get(k) ?? []), r]);
  }
  const parts: RawResultRow[][] = [];
  let current: RawResultRow[] = [];
  for (const group of byRoll.values()) {
    if (current.length > 0 && current.length + group.length > PART_ROWS) {
      parts.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50";

export default function ImportSemesterResultsPage() {
  return (
    <Suspense fallback={<div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />}>
      <ImportSemesterResults />
    </Suspense>
  );
}

function ImportSemesterResults() {
  const router = useRouter();
  const appendTo = useSearchParams().get("batchId");
  const [draft, setDraft] = useState<ExamResultBatch | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [regulation, setRegulation] = useState("");
  const [academicYear, setAcademicYear] = useState(() => currentTimetableAcademicYear());
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [examType, setExamType] = useState<ExamResultType>("REGULAR");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RawResultRow[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<null | "check" | "save" | "template">(null);
  const [progress, setProgress] = useState("");

  // Adding to a draft: its own exam details, locked.
  useEffect(() => {
    if (!appendTo) return;
    fetch(`/api/college/exam-results/batches/${encodeURIComponent(appendTo)}`)
      .then((r) => r.json() as Promise<{ batch?: ExamResultBatch; error?: string }>)
      .then((d) => {
        if (!d.batch) { toast({ variant: "destructive", title: d.error ?? "Results sheet not found" }); return; }
        if (d.batch.status !== "DRAFT") { toast({ variant: "destructive", title: "These results are published and can no longer be added to" }); return; }
        setDraft(d.batch);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the draft" }));
  }, [appendTo]);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
    ])
      .then(([c, d]) => { setCourses(c.courses ?? []); setDepartments(d.departments ?? []); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, []);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const group = groups.find((g) => g.key === courseKey) ?? null;
  // The branches that run this programme: the departments owning one of its Course docs.
  const branches = useMemo(() => {
    if (!group) return [];
    const ids = new Set(courses.filter((c) => group.courseIds.includes(c.id)).map((c) => c.departmentId));
    return departments.filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [group, courses, departments]);
  const branch = branches.find((d) => d.id === departmentId) ?? null;

  // The programme's subjects (for its regulations and the template's code list) and its year timings (for semesters).
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    const q = group.catalogId ? `catalogId=${encodeURIComponent(group.catalogId)}` : `courseId=${encodeURIComponent(group.courseIds[0])}`;
    void Promise.all([
      fetch(`/api/college/subjects?${q}`).then((r) => r.json() as Promise<{ subjects?: Subject[] }>).catch(() => ({ subjects: [] })),
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(group.courseIds.join(","))}`)
        .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>).catch(() => ({ timings: [] })),
    ]).then(([s, t]) => {
      if (cancelled) return;
      setSubjects(s.subjects ?? []);
      setTimings(t.timings ?? []);
    });
    return () => { cancelled = true; };
  }, [group]);

  const regulations = useMemo(
    () => [...new Set(subjects.map((s) => (s.regulation ?? "").trim().toUpperCase()).filter(Boolean))].sort(),
    [subjects]
  );
  const years = group ? courseYearNumbers(group.durationYears) : [];
  // The year's own semesters when its timings say so, else two a year.
  const semesters = useMemo(() => {
    const y = Number(year);
    if (!y) return [];
    const own = [...new Set(timings.filter((t) => Number(t.year) === y).flatMap((t) => (t.semesters ?? []).map((s) => s.semester)))].sort((a, b) => a - b);
    return own.length > 0 ? own : [2 * y - 1, 2 * y];
  }, [timings, year]);

  const meta: ResultBatchMeta | null = draft
    ? { courseKey: draft.courseKey, courseName: draft.courseName, courseIds: draft.courseIds, department: draft.department ?? "", departmentId: draft.departmentId ?? "", regulation: draft.regulation, academicYear: draft.academicYear, year: draft.year, semester: draft.semester, examType: draft.examType }
    : appendTo
      ? null
      : group && branch && year && semester
        ? { courseKey: group.key, courseName: group.name, courseIds: group.courseIds, department: branch.name, departmentId: branch.id, regulation, academicYear, year: Number(year), semester: Number(semester), examType }
        : null;

  function resetFile() {
    setRows([]);
    setFileName("");
    setIgnored([]);
    setSummary(null);
    setParseError("");
  }
  function pickCourse(v: string) {
    setCourseKey(v);
    setDepartmentId("");
    setRegulation("");
    setYear("");
    setSemester("");
    setSubjects([]);
    setTimings([]);
    setSummary(null);
  }

  async function downloadTemplate() {
    setBusy("template");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Results");
      sheet.addRow(RESULT_COLUMNS.map((c) => c.label));
      sheet.getRow(1).font = { bold: true };
      sheet.columns = RESULT_COLUMNS.map(() => ({ width: 18 }));
      sheet.addRow(["24A91A0501", "MA101", "A"]);
      sheet.addRow(["24A91A0501", "CS101", "F"]);

      // The programme's subjects, so codes can be copied rather than typed.
      const list = wb.addWorksheet("Subject Codes");
      list.addRow(["Subject Code", "Subject Name", "Credits", "Regulation"]);
      list.getRow(1).font = { bold: true };
      list.columns = [{ width: 16 }, { width: 44 }, { width: 10 }, { width: 12 }];
      subjects
        .filter((s) => !regulation || !s.regulation || s.regulation.trim().toUpperCase() === regulation)
        .sort((a, b) => a.code.localeCompare(b.code))
        .forEach((s) => list.addRow([s.code, s.name, s.credits ?? 0, s.regulation ?? ""]));

      const help = wb.addWorksheet("How to fill");
      [
        "One row per student per subject: Roll No, Subject Code and Grade - all three required.",
        "Subject Code may be the college's code (UGBS1T0523) or the university's code (R232101) once that is set on the subject under Academics > Subjects.",
        "Grade must be one of the grades in Result Rules (e.g. S, A, B ... F, AB).",
        "Every student must belong to the branch picked on the import page.",
        "Credits are taken from each subject's own record - not from this file. No marks are imported.",
        "Delete the two example rows before uploading.",
      ].forEach((t) => help.addRow([t]));
      help.getColumn(1).width = 110;

      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "semester_results_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Couldn't build the template" });
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    resetFile();
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xls")) { setParseError("Legacy .xls files aren't supported - re-save as .xlsx or .csv."); return; }
    try {
      let parsed: string[][];
      let numbers: number[];
      if (lower.endsWith(".xlsx")) {
        const excel = await parseExcelFileWithRowNumbers(file);
        parsed = excel.rows;
        numbers = excel.rowNumbers;
      } else {
        parsed = parseCSV(await readFileAsText(file));
        numbers = parsed.map((_, i) => i + 1);
      }
      if (parsed.length < 2) { setParseError("The file needs a header row and at least one data row."); return; }

      const { keyMap, missing, ignored: extra } = resolveResultHeaders(parsed[0]);
      if (missing.length > 0) { setParseError(`Missing column(s): ${missing.join(", ")}. The header row must be the first row.`); return; }
      const data: RawResultRow[] = [];
      parsed.slice(1).forEach((cells, i) => {
        const r: RawResultRow = { row: numbers[i + 1] ?? i + 2 };
        cells.forEach((v, c) => { if (keyMap[c]) (r as unknown as Record<string, string>)[keyMap[c]] = v; });
        if (Object.entries(r).some(([k, v]) => k !== "row" && String(v ?? "").trim())) data.push(r);
      });
      if (data.length === 0) { setParseError("No data rows found under the header."); return; }
      if (data.length > MAX_FILE_ROWS) { setParseError(`At most ${MAX_FILE_ROWS.toLocaleString()} rows per file - split it and import in parts.`); return; }
      setRows(data);
      setIgnored(extra);
      setFileName(file.name);
    } catch {
      setParseError("Couldn't read the file. Check it is a valid .xlsx or .csv.");
    }
  }

  async function run(dryRun: boolean) {
    if (!meta || rows.length === 0) return;
    setBusy(dryRun ? "check" : "save");
    const parts = partsOf(rows);
    const total: Summary = { students: 0, subjectRows: 0, failed: [], zeroCreditCodes: [] };
    let batchId: string | null = draft?.id ?? null;
    try {
      for (let i = 0; i < parts.length; i++) {
        setProgress(parts.length > 1 ? `Part ${i + 1} of ${parts.length}…` : "");
        const res: Response = await fetch("/api/college/exam-results/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun, rows: parts[i], ...(batchId ? { batchId } : { meta }) }),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<Summary> & { batchId?: string | null; error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: json.error ?? "Import failed" });
          if (batchId) router.push(`/exam-cell/semester-results/${batchId}`);
          return;
        }
        total.students += json.students ?? 0;
        total.subjectRows += json.subjectRows ?? 0;
        total.failed.push(...(json.failed ?? []));
        total.zeroCreditCodes = [...new Set([...total.zeroCreditCodes, ...(json.zeroCreditCodes ?? [])])];
        if (!dryRun && json.batchId) batchId = json.batchId;
      }
      total.failed.sort((a, b) => a.row - b.row);
      setSummary(total);
      if (!dryRun) {
        if (batchId) {
          toast({ variant: "success", title: `Saved as draft: ${total.students} students`, description: total.failed.length ? `${total.failed.length} row(s) were refused.` : undefined });
          router.push(`/exam-cell/semester-results/${batchId}`);
        } else {
          toast({ variant: "destructive", title: "Nothing was saved - every row was refused" });
        }
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
      if (batchId) router.push(`/exam-cell/semester-results/${batchId}`);
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={appendTo ? "Add Rows to Draft" : "Import Semester Results"}
        description={appendTo
          ? "Upload the corrected rows. They are checked the same way and added to this draft."
          : "Pick the exam, upload the results sheet, check it, then save it as a draft. Nothing is visible to students until you publish."}
        actions={<Button variant="outline" asChild><Link href="/exam-cell/semester-results"><ArrowLeft className="mr-1.5 h-4 w-4" />All results</Link></Button>}
      />

      {appendTo ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adding to</CardTitle>
            <CardDescription>{draft ? draft.title : "Loading…"}</CardDescription>
          </CardHeader>
        </Card>
      ) : (<>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Which exam</CardTitle>
          <CardDescription>Applies to every row of the file.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sr-course">Course *</Label>
            <select id="sr-course" className={selectClass} value={courseKey} onChange={(e) => pickCourse(e.target.value)}>
              <option value="">Select a course</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-branch">Branch *</Label>
            <select id="sr-branch" className={selectClass} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setSummary(null); }} disabled={!group}>
              <option value="">{group && branches.length === 0 ? "No branch runs this course" : "Select a branch"}</option>
              {branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-regulation">Regulation</Label>
            <select id="sr-regulation" className={selectClass} value={regulation} onChange={(e) => { setRegulation(e.target.value); setSummary(null); }} disabled={!group}>
              <option value="">{regulations.length ? "Not specified (default grade table)" : "None set for this course"}</option>
              {regulations.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-ay">Academic Year *</Label>
            <select id="sr-ay" className={selectClass} value={academicYear} onChange={(e) => { setAcademicYear(e.target.value); setSummary(null); }}>
              {[...new Set([academicYear, ...recentAcademicSessions()])].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-year">Year *</Label>
            <select id="sr-year" className={selectClass} value={year} onChange={(e) => { setYear(e.target.value); setSemester(""); setSummary(null); }} disabled={!group}>
              <option value="">Select a year</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-sem">Semester *</Label>
            <select id="sr-sem" className={selectClass} value={semester} onChange={(e) => { setSemester(e.target.value); setSummary(null); }} disabled={!year}>
              <option value="">Select a semester</option>
              {semesters.map((s, i) => <option key={s} value={s}>Semester {s} ({year}-{i + 1})</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-type">Exam *</Label>
            <select id="sr-type" className={selectClass} value={examType} onChange={(e) => { setExamType(e.target.value as ExamResultType); setSummary(null); }}>
              <option value="REGULAR">Regular</option>
              <option value="SUPPLEMENTARY">Supplementary</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Template</CardTitle>
          <CardDescription>
            One row per student per subject: Roll No, Subject Code, Grade. The code may be the college code or the university code
            (e.g. R232101) set on the subject - so the university&rsquo;s result export can be uploaded as it is. Your own results sheet works too if its headings are close
            (e.g. HTNO, Sub Code, Grade Secured); other columns such as Name, Credits or marks are ignored - only grades are imported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void downloadTemplate()} loading={busy === "template"} disabled={!group}>
            <Download className="mr-1.5 h-4 w-4" />Download template{group ? " (with this course's subject codes)" : ""}
          </Button>
        </CardContent>
      </Card>
      </>)}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{appendTo ? "Upload and check" : "3. Upload and check"}</CardTitle>
          {meta && <CardDescription>{batchTitle(meta)}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm ${meta ? "hover:bg-muted/40" : "pointer-events-none opacity-50"}`}>
            <Upload className="h-4 w-4" />
            {fileName ? <span><FileSpreadsheet className="mr-1 inline h-4 w-4" />{fileName} · {rows.length.toLocaleString()} rows</span> : "Choose the results file (.xlsx or .csv)"}
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => void handleFile(e)} disabled={!meta} />
          </label>
          {!meta && !appendTo && <p className="text-xs text-muted-foreground">Pick the course, branch, year and semester first.</p>}
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          {ignored.length > 0 && <p className="text-xs text-muted-foreground">Ignored columns: {ignored.join(", ")}</p>}

          {rows.length > 0 && meta && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void run(true)} loading={busy === "check"} disabled={busy !== null}>
                <Search className="mr-1.5 h-4 w-4" />Check file
              </Button>
              <Button onClick={() => void run(false)} loading={busy === "save"} disabled={busy !== null || !summary || summary.students === 0}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />{appendTo ? "Add to draft" : "Save as draft"}
              </Button>
              {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
              {!summary && <span className="text-xs text-muted-foreground">Check the file first - nothing is saved until you press Save as draft.</span>}
            </div>
          )}

          {summary && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">{summary.students} students ready</Badge>
                <Badge variant="secondary">{summary.subjectRows} subject results ready</Badge>
                <Badge variant={summary.failed.length ? "destructive" : "secondary"}>{summary.failed.length} row(s) refused</Badge>
              </div>
              {summary.zeroCreditCodes.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No credits set for: {summary.zeroCreditCodes.join(", ")} - these count as zero-credit subjects (left out of SGPA, still must be passed). Set credits under Subjects if that is wrong.
                </p>
              )}
              {summary.failed.length > 0 && (
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">Roll No</th><th className="p-2 text-left">Subject</th><th className="p-2 text-left">Why it was refused</th></tr>
                    </thead>
                    <tbody>
                      {summary.failed.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{f.row}</td><td className="p-2">{f.rollNumber}</td><td className="p-2">{f.subjectCode}</td><td className="p-2 text-destructive">{f.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Refused rows are skipped, and so are the other rows of the same student - a student is saved whole or not at all.
                After saving, correct those rows and use <span className="font-medium">Add rows</span> on the draft to add them.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
