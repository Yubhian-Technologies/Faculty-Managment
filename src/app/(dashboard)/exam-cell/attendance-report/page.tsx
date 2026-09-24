"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import ExcelJS from "exceljs";
import type { Course, Department } from "@/types";

// A student below this is flagged - the near-universal exam-eligibility
// threshold in Indian engineering colleges. Purely a display cue; the actual
// filtering is whatever From/To % the user sets.
const LOW_ATTENDANCE_THRESHOLD = 75;

interface ReportRow {
  studentId: string;
  name: string;
  rollNumber: string;
  sectionName: string;
  held: number;
  attended: number;
  percentage: number;
}

interface SectionOption { id: string; name: string }

// Semester numbers (1..durationYears*2), same convention as Circulars' own
// semester field. Attendance/rosters are only ever tracked per academic Year
// though (see attendance-percentage-report/route.ts) - so picking either
// semester of a year (e.g. 3 or 4) resolves to the same underlying Year and
// returns the same report; see yearForSemester below.
function yearForSemester(semester: number): number {
  return Math.ceil(semester / 2);
}

export default function ExamCellAttendanceReportPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [courseName, setCourseName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [semester, setSemester] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [minPct, setMinPct] = useState("");
  const [maxPct, setMaxPct] = useState("");

  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);

  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [meta, setMeta] = useState<{ totalStudents: number; matchedCount: number; sectionsCount: number } | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingData(true);
      try {
        const [courseRes, deptRes] = await Promise.all([
          fetch("/api/college/courses"),
          fetch("/api/college/departments"),
        ]);
        const courseJson = (await courseRes.json()) as { courses?: Course[] };
        const deptJson = (await deptRes.json()) as { departments?: Department[] };
        setCourses(courseJson.courses ?? []);
        setDepartments(deptJson.departments ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses/departments" });
      } finally {
        setIsLoadingData(false);
      }
    })();
  }, []);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);

  // Once a Course is picked, only departments that actually offer it (guides
  // the form toward a valid Course+Department pair instead of letting one be
  // chosen that resolves to nothing).
  const departmentOptions = useMemo(() => {
    if (!courseName) return departments;
    const ids = new Set(courses.filter((c) => c.name === courseName).map((c) => c.departmentId));
    return departments.filter((d) => ids.has(d.id));
  }, [departments, courses, courseName]);

  const selectedDepartment = useMemo(() => departments.find((d) => d.id === departmentId), [departments, departmentId]);
  const resolvedCourse = useMemo(
    () => courses.find((c) => c.name === courseName && c.departmentId === departmentId) ?? null,
    [courses, courseName, departmentId]
  );

  const totalSemesters = (resolvedCourse?.durationYears ?? 0) * 2;
  const semesterOptions = useMemo(
    () => Array.from({ length: totalSemesters }, (_, i) => i + 1),
    [totalSemesters]
  );

  function resetDownstream(from: "course" | "department" | "semester") {
    if (from === "course") { setDepartmentId(""); setSemester(""); setSectionId(""); }
    if (from === "department") { setSemester(""); setSectionId(""); }
    if (from === "semester") setSectionId("");
    setSectionOptions([]);
    setRows(null);
    setMeta(null);
  }

  // Section options load once Course+Department+Semester resolve to a real
  // scope - "All sections" (sectionId="") stays valid throughout.
  useEffect(() => {
    void (async () => {
      // Already cleared by resetDownstream whenever one of these becomes
      // unset (course/department/semester change) - nothing to reset here.
      if (!resolvedCourse || !departmentId || !semester || !selectedDepartment) return;
      setIsLoadingSections(true);
      try {
        const params = new URLSearchParams({
          department: selectedDepartment.name, courseId: resolvedCourse.id,
          year: String(yearForSemester(Number(semester))), listSections: "true",
        });
        const res = await fetch(`/api/college/attendance-percentage-report?${params}`);
        const data = (await res.json()) as { sections?: SectionOption[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load sections");
        setSectionOptions(data.sections ?? []);
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load sections" });
      } finally {
        setIsLoadingSections(false);
      }
    })();
  }, [resolvedCourse, departmentId, semester, selectedDepartment]);

  // Accepts explicit From/To overrides so the "Below 75%" quick filter can
  // set the fields and run in the same click - reading `minPct`/`maxPct`
  // from state right after setting them would still see the pre-update
  // values (state updates aren't synchronous).
  async function runReport(overrides?: { minPct?: string; maxPct?: string }) {
    const effectiveMinPct = overrides?.minPct ?? minPct;
    const effectiveMaxPct = overrides?.maxPct ?? maxPct;
    if (!resolvedCourse || !selectedDepartment || !semester) {
      toast({ variant: "destructive", title: "Select Course, Department and Semester" });
      return;
    }
    if (effectiveMinPct && effectiveMaxPct && Number(effectiveMinPct) > Number(effectiveMaxPct)) {
      toast({ variant: "destructive", title: "\"From %\" must not be greater than \"To %\"" });
      return;
    }
    setIsRunning(true);
    try {
      const params = new URLSearchParams({
        department: selectedDepartment.name, courseId: resolvedCourse.id,
        year: String(yearForSemester(Number(semester))),
      });
      if (sectionId) params.set("sectionId", sectionId);
      if (effectiveMinPct) params.set("minPct", effectiveMinPct);
      if (effectiveMaxPct) params.set("maxPct", effectiveMaxPct);
      const res = await fetch(`/api/college/attendance-percentage-report?${params}`);
      const data = (await res.json()) as {
        students?: ReportRow[]; totalStudents?: number; matchedCount?: number; sectionsCount?: number; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to generate report");
      setRows(data.students ?? []);
      setMeta({
        totalStudents: data.totalStudents ?? 0,
        matchedCount: data.matchedCount ?? 0,
        sectionsCount: data.sectionsCount ?? 0,
      });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to generate report" });
    } finally {
      setIsRunning(false);
    }
  }

  // Values are rounded whole percentages, so "below 75%" is exactly <=74 -
  // matches the inclusive To-% filter the API already applies.
  function applyBelow75Filter() {
    setMinPct("");
    setMaxPct("74");
    void runReport({ minPct: "", maxPct: "74" });
  }

  const reportLabel = useMemo(() => {
    if (!resolvedCourse || !selectedDepartment || !semester) return "Attendance Report";
    const sectionName = sectionId ? sectionOptions.find((s) => s.id === sectionId)?.name : null;
    return [
      `${resolvedCourse.name} - ${selectedDepartment.name}`,
      `Sem ${semester}/${resolvedCourse.durationYears * 2}`,
      sectionName ? `Section ${sectionName}` : "All Sections",
    ].join(" - ");
  }, [resolvedCourse, selectedDepartment, semester, sectionId, sectionOptions]);

  function downloadPdf() {
    if (!rows || rows.length === 0) return;
    const tableHead = `<tr>${["Roll No", "Name", "Section", "Attendance %"]
      .map((h) => `<th style="border:1px solid #999;background:#0a0a7a;color:#fff;padding:4px 6px;font-size:11px;white-space:nowrap;">${h}</th>`)
      .join("")}</tr>`;
    const tableBody = rows
      .map((r) => `<tr>${[r.rollNumber, r.name, r.sectionName, `${r.percentage}%`]
        .map((v) => `<td style="border:1px solid #ccc;padding:4px 6px;font-size:11px;">${v}</td>`)
        .join("")}</tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;margin:16px;}table{border-collapse:collapse;width:100%;}</style></head><body><h3 style="margin:0 0 4px;text-align:center;">${reportLabel}</h3><p style="margin:0 0 12px;text-align:center;font-size:11px;color:#666;">${rows.length} student(s)</p><table>${tableHead}${tableBody}</table></body></html>`;
    void renderHtmlToPdf(html, `${reportLabel.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`);
  }

  async function downloadExcel() {
    if (!rows || rows.length === 0) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Attendance");
    sheet.columns = [
      { header: "Roll No", key: "rollNumber", width: 15 },
      { header: "Name", key: "name", width: 28 },
      { header: "Section", key: "sectionName", width: 12 },
      { header: "Attendance %", key: "percentage", width: 14 },
    ];
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reportLabel.replace(/[^a-zA-Z0-9]+/g, "-")}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Attendance Reports"
        description="Each student's overall attendance percentage across their currently-assigned subjects, for a Course + Department + Semester (optionally one Section) - narrow further with a percentage range, e.g. everyone below 75%."
      />

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={courseName} onValueChange={(v) => { setCourseName(v); resetDownstream("course"); }} disabled={isLoadingData}>
              <SelectTrigger><SelectValue placeholder={isLoadingData ? "Loading…" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {courseNameOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Department</Label>
            <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); resetDownstream("department"); }} disabled={!courseName}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departmentOptions.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No department offers this course</div>
                )}
                {departmentOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Semester</Label>
            <Select value={semester} onValueChange={(v) => { setSemester(v); resetDownstream("semester"); }} disabled={!resolvedCourse}>
              <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
              <SelectContent>
                {semesterOptions.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}/{totalSemesters}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Section <span className="font-normal text-muted-foreground">(optional - all sections if left blank)</span></Label>
            <Select value={sectionId || "ALL"} onValueChange={(v) => setSectionId(v === "ALL" ? "" : v)} disabled={!semester || isLoadingSections}>
              <SelectTrigger><SelectValue placeholder={isLoadingSections ? "Loading…" : "All sections"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sections</SelectItem>
                {sectionOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Attendance % - From <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input type="number" min={0} max={100} value={minPct} onChange={(e) => setMinPct(e.target.value)} placeholder="e.g. 0" />
          </div>
          <div className="space-y-2">
            <Label>Attendance % - To <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input type="number" min={0} max={100} value={maxPct} onChange={(e) => setMaxPct(e.target.value)} placeholder="e.g. 75" />
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyBelow75Filter}
              disabled={!resolvedCourse || !semester || isRunning}
            >
              Below 75%
            </Button>
            <Button onClick={() => void runReport()} loading={isRunning} disabled={!resolvedCourse || !semester}>
              <Search className="h-4 w-4 mr-2" />Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows !== null && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {meta && (
                <p className="text-xs text-muted-foreground">
                  {meta.matchedCount} of {meta.totalStudents} student(s) match, across {meta.sectionsCount} section(s).
                </p>
              )}
              {rows.length > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={downloadPdf}>
                    <FileDown className="h-3.5 w-3.5 mr-1.5" />Download PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void downloadExcel()}>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Download Excel
                  </Button>
                </div>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No students match this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3">Roll No</th>
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Section</th>
                      <th className="pb-2">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.studentId} className="border-b last:border-0">
                        <td className="py-2 pr-3">{r.rollNumber}</td>
                        <td className="py-2 pr-3">{r.name}</td>
                        <td className="py-2 pr-3">{r.sectionName}</td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px]",
                              r.percentage < LOW_ATTENDANCE_THRESHOLD && "border-destructive/40 bg-destructive/10 text-destructive"
                            )}
                          >
                            {r.percentage}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
