"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Search, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { parseCSV, parseExcelFileWithRowNumbers, readFileAsText } from "@/lib/utils/csv";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { courseYearNumbers } from "@/lib/college/courseYears";
import { batchTitle, examHeldLabel, resolveResultHeaders, type ResultBatchMeta } from "@/lib/examResults/sheet";
import type { FailedResultRow, RawResultRow } from "@/lib/examResults/importRows";
import type { Course, CourseYearTiming, Department } from "@/types";
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

/** This month as "YYYY-MM" - the latest an exam can have been held. */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Sitting = { id: string; title: string; examType: ExamResultType; examHeld: string; students: number; withBacklogs: number };

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
  // Optional: one sub-department of the branch ("" = the whole branch, sub-departments included).
  const [subDepartmentId, setSubDepartmentId] = useState("");
  const [regulation, setRegulation] = useState("");
  // The programme's regulations and the batches each covers (Academics > Regulation).
  const [regOptions, setRegOptions] = useState<{ regulation: string; batches: string[] }[]>([]);
  const [batch, setBatch] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [examType, setExamType] = useState<ExamResultType>("REGULAR");
  // Month the exam was held ("YYYY-MM"); a Revaluation takes its exam's.
  const [examHeld, setExamHeld] = useState("");
  // Supplementary / Revaluation: the published exam it is for, picked from `sittings`.
  const [targetBatchId, setTargetBatchId] = useState("");
  const [sittings, setSittings] = useState<Sitting[]>([]);
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
  const subDepartments = useMemo(
    () => (branch ? departments.filter((d) => d.parentDepartmentId === branch.id).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [branch, departments]
  );
  const subDepartment = subDepartments.find((d) => d.id === subDepartmentId) ?? null;

  // The programme's year timings (for its semesters).
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(group.courseIds.join(","))}`)
      .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
      .then((t) => { if (!cancelled) setTimings(t.timings ?? []); })
      .catch(() => { if (!cancelled) setTimings([]); });
    return () => { cancelled = true; };
  }, [group]);

  // Regulations and their batches, from the programme's catalog entry.
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    fetch(`/api/college/exam-results/options?courseKey=${encodeURIComponent(group.key)}`)
      .then((r) => r.json() as Promise<{ regulations?: { regulation: string; batches: string[] }[] }>)
      .then((d) => { if (!cancelled) setRegOptions(d.regulations ?? []); })
      .catch(() => { if (!cancelled) setRegOptions([]); });
    return () => { cancelled = true; };
  }, [group]);
  const batches = regOptions.find((r) => r.regulation === regulation)?.batches ?? [];
  const batchYears = batch ? Number(batch.slice(5)) - Number(batch.slice(0, 4)) : 0;
  const years = group ? courseYearNumbers(group.durationYears).filter((y) => !batchYears || y <= batchYears) : [];
  // The year's own semesters when its timings say so, else two a year.
  const semesters = useMemo(() => {
    const y = Number(year);
    if (!y) return [];
    const own = [...new Set(timings.filter((t) => Number(t.year) === y).flatMap((t) => (t.semesters ?? []).map((s) => s.semester)))].sort((a, b) => a - b);
    return own.length > 0 ? own : [2 * y - 1, 2 * y];
  }, [timings, year]);

  // The published exams of this class a Supplementary / Revaluation can be for.
  useEffect(() => {
    if (!group || !batch || !departmentId || !year || !semester || examType === "REGULAR") return;
    let cancelled = false;
    const q = new URLSearchParams({ courseKey: group.key, batch, departmentId, year, semester, ...(subDepartmentId ? { subDepartmentId } : {}) });
    fetch(`/api/college/exam-results/sittings?${q}`)
      .then((r) => r.json() as Promise<{ sittings?: Sitting[] }>)
      .then((d) => { if (!cancelled) setSittings(d.sittings ?? []); })
      .catch(() => { if (!cancelled) setSittings([]); });
    return () => { cancelled = true; };
  }, [group, batch, departmentId, subDepartmentId, year, semester, examType]);
  const target = sittings.find((x) => x.id === targetBatchId) ?? null;
  const needsTarget = examType !== "REGULAR";

  const meta: ResultBatchMeta | null = draft
    ? {
        courseKey: draft.courseKey, courseName: draft.courseName, courseIds: draft.courseIds, department: draft.department ?? "", departmentId: draft.departmentId ?? "",
        ...(draft.subDepartmentId ? { subDepartment: draft.subDepartment ?? "", subDepartmentId: draft.subDepartmentId } : {}),
        regulation: draft.regulation, batch: draft.batch ?? "", examHeld: draft.examHeld ?? "", academicYear: draft.academicYear, year: draft.year, semester: draft.semester, examType: draft.examType,
        ...(draft.targetBatchId ? { targetBatchId: draft.targetBatchId } : {}), ...(draft.revaluationOf ? { revaluationOf: draft.revaluationOf } : {}),
      }
    : appendTo
      ? null
      : group && regulation && batch && branch && year && semester && (!needsTarget || target) && (examType === "REVALUATION" || examHeld)
        ? {
            courseKey: group.key, courseName: group.name, courseIds: group.courseIds, department: branch.name, departmentId: branch.id,
            ...(subDepartment ? { subDepartment: subDepartment.name, subDepartmentId: subDepartment.id } : {}),
            regulation, batch, year: Number(year), semester: Number(semester), examType,
            // The server derives the academic year and, for a Revaluation, takes the date from the picked exam.
            examHeld: examType === "REVALUATION" ? target?.examHeld ?? "" : examHeld, academicYear: "",
            ...(needsTarget && target ? { targetBatchId: target.id } : {}),
            ...(examType === "REVALUATION" && target ? { revaluationOf: target.examType as "REGULAR" | "SUPPLEMENTARY" } : {}),
          }
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
    setSubDepartmentId("");
    setRegulation("");
    setRegOptions([]);
    setBatch("");
    setYear("");
    setSemester("");
    setTargetBatchId("");
    setSittings([]);
    setTimings([]);
    setSummary(null);
  }
  // Any change to the class clears the picked exam (it belongs to one class).
  function changeClass(apply: () => void) {
    apply();
    setTargetBatchId("");
    setSummary(null);
  }

  async function downloadTemplate() {
    setBusy("template");
    try {
      // Supplementary / Revaluation: pre-filled from the picked exam.
      type Prefill = { rollNumber: string; name: string; subjectCode: string; subjectName: string };
      let prefilled: Prefill[] | null = null;
      if (needsTarget && target) {
        const res = await fetch(`/api/college/exam-results/batches/${encodeURIComponent(target.id)}/template?for=${examType}`);
        const json = (await res.json()) as { rows?: Prefill[]; error?: string };
        if (!res.ok) throw new Error(json.error);
        prefilled = json.rows ?? [];
      }
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Results");
      sheet.addRow(["Roll No", "Subject Code", "Grade", "University SGPA"]);
      sheet.getRow(1).font = { bold: true };
      sheet.columns = [{ width: 16 }, { width: 16 }, { width: 10 }, { width: 16 }];
      if (prefilled) for (const r of prefilled) sheet.addRow([r.rollNumber, r.subjectCode, "", ""]);
      else {
        sheet.addRow(["24A91A0501", "MA101", "A", "8.69"]);
        sheet.addRow(["24A91A0501", "CS101", "F", ""]);
      }

      const help = wb.addWorksheet("How to fill");
      [
        "One row per student per subject: Roll No, Subject Code and Grade - all three required.",
        "Subject Code may be the college's code (UGBS1T0523) or the university's code (R232101) once that is set on the subject under Academics > Subjects.",
        "Grade must be one of the grades in Result Rules (e.g. S, A, B ... F, AB).",
        "Zero-credit subjects (mandatory / audit courses) are Pass / Fail only: any grade given is a Pass, except a failing one (F, AB, MP, WH - as marked in Result Rules), which is a Fail.",
        "Every student must belong to the batch and branch picked on the import page.",
        "University SGPA is optional - the university's SGPA for the student (on any one of their rows, \"-\" if withheld). It is only compared with the system's, never used to calculate.",
        "A Supplementary template lists every subject still not passed; a Revaluation template lists every subject of the exam - delete the rows that were not revalued.",
        "Credits are taken from each subject's own record - not from this file. No marks are imported.",
        "Delete any example rows before uploading.",
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
            <Label htmlFor="sr-regulation">Regulation *</Label>
            <select id="sr-regulation" className={selectClass} value={regulation} onChange={(e) => changeClass(() => { setRegulation(e.target.value); setBatch(""); setYear(""); setSemester(""); })} disabled={!group}>
              <option value="">{group && regOptions.length === 0 ? "None set - add under Academics > Regulation" : "Select a regulation"}</option>
              {regOptions.map((r) => <option key={r.regulation} value={r.regulation}>{r.regulation}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-batch">Batch *</Label>
            <select id="sr-batch" className={selectClass} value={batch} onChange={(e) => changeClass(() => { setBatch(e.target.value); setYear(""); setSemester(""); })} disabled={!regulation}>
              <option value="">{regulation && batches.length === 0 ? "No batches set for this regulation" : "Select a batch"}</option>
              {batches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-branch">Branch *</Label>
            <select id="sr-branch" className={selectClass} value={departmentId} onChange={(e) => changeClass(() => { setDepartmentId(e.target.value); setSubDepartmentId(""); })} disabled={!group}>
              <option value="">{group && branches.length === 0 ? "No branch runs this course" : "Select a branch"}</option>
              {branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {subDepartments.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="sr-sub">Sub-Department</Label>
              <select id="sr-sub" className={selectClass} value={subDepartmentId} onChange={(e) => changeClass(() => setSubDepartmentId(e.target.value))}>
                <option value="">All of {branch?.name} (incl. sub-departments)</option>
                {subDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sr-year">Year *</Label>
            <select id="sr-year" className={selectClass} value={year} onChange={(e) => changeClass(() => { setYear(e.target.value); setSemester(""); })} disabled={!batch}>
              <option value="">Select a year</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-sem">Semester *</Label>
            <select id="sr-sem" className={selectClass} value={semester} onChange={(e) => changeClass(() => setSemester(e.target.value))} disabled={!year}>
              <option value="">Select a semester</option>
              {semesters.map((s, i) => <option key={s} value={s}>Semester {s} ({year}-{i + 1})</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-type">Exam *</Label>
            <select id="sr-type" className={selectClass} value={examType} onChange={(e) => changeClass(() => setExamType(e.target.value as ExamResultType))}>
              <option value="REGULAR">Regular</option>
              <option value="SUPPLEMENTARY">Supplementary</option>
              <option value="REVALUATION">Revaluation</option>
            </select>
          </div>
          {needsTarget && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sr-target">{examType === "SUPPLEMENTARY" ? "Re-sit of *" : "Revalue *"}</Label>
              <select id="sr-target" className={selectClass} value={targetBatchId} onChange={(e) => { setTargetBatchId(e.target.value); setSummary(null); }} disabled={!semester || sittings.length === 0}>
                <option value="">
                  {!semester ? "Pick the class first" : sittings.length === 0 ? "No published exam for this class yet" : "Select the exam"}
                </option>
                {sittings.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.examType === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} · {examHeldLabel(x.examHeld) || "date not set"} · {x.students} students · {x.withBacklogs} with backlogs
                  </option>
                ))}
              </select>
              {examType === "REVALUATION" && target && (
                <p className="text-xs text-muted-foreground">
                  Revaluation of {target.examType === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} {examHeldLabel(target.examHeld)} - only the revalued subjects; the better of the two grades counts.
                </p>
              )}
            </div>
          )}
          {examType !== "REVALUATION" && (
            <div className="space-y-1.5">
              <Label htmlFor="sr-held">Exam held *</Label>
              <Input id="sr-held" type="month" max={thisMonth()} value={examHeld} onChange={(e) => { setExamHeld(e.target.value); setSummary(null); }} />
              {examType === "SUPPLEMENTARY" && target?.examHeld && <p className="text-xs text-muted-foreground">After {examHeldLabel(target.examHeld)}.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Template</CardTitle>
          <CardDescription>
            One row per student per subject: Roll No, Subject Code, Grade. The code must be the subject&rsquo;s college code. Your own results sheet works too if its headings are close
            (e.g. HTNO, Sub Code, Grade Secured); other columns such as Name, Credits or marks are ignored - only grades are imported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void downloadTemplate()} loading={busy === "template"} disabled={!group || (needsTarget && !target)}>
            <Download className="mr-1.5 h-4 w-4" />{needsTarget ? (target ? (examType === "SUPPLEMENTARY" ? "Download template (subjects still to pass)" : "Download template (this exam's subjects)") : "Pick the exam first") : "Download template"}
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
          {!meta && !appendTo && <p className="text-xs text-muted-foreground">Pick the course, regulation, batch, branch, year, semester{needsTarget ? ", the exam" : ""}{examType !== "REVALUATION" ? " and the month it was held" : ""} first.</p>}
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
