"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GraduationCap, History, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { IncidentStudentPicker } from "@/components/incidents/IncidentStudentPicker";
import { IncidentFacultyPicker } from "@/components/incidents/IncidentFacultyPicker";
import { toast } from "@/hooks/useToast";
import { selectableYears } from "@/lib/college/courseYears";
import type {
  AcademicYear, Course, Department, IncidentAffectedType, IncidentFaculty, IncidentReport, IncidentStudent,
} from "@/types";

const TYPE_LABELS: Record<IncidentAffectedType, string> = { STUDENT: "Student", FACULTY: "Faculty", BOTH: "Both" };
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;

function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// yyyy-mm-dd is a calendar date, not an instant - parse it as local parts so it
// never slips a day across the timezone.
function formatIncidentDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value || "-";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatSubmitted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ordinalYear(year: number | null) {
  if (!year) return "-";
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

type FieldErrors = { people?: string; date?: string; title?: string; description?: string };

export default function IncidentReportPage() {
  const [view, setView] = useState<"form" | "history">("form");

  // Filter metadata, shared by both pickers.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [years, setYears] = useState<number[]>([]);

  const [includeStudents, setIncludeStudents] = useState(false);
  const [includeFaculty, setIncludeFaculty] = useState(false);
  const [students, setStudents] = useState<Record<string, IncidentStudent>>({});
  const [faculty, setFaculty] = useState<Record<string, IncidentFaculty>>({});
  const [incidentDate, setIncidentDate] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  const [reports, setReports] = useState<IncidentReport[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openReport, setOpenReport] = useState<IncidentReport | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [deptsRes, yearsRes, coursesRes] = await Promise.all([
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
          fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
        ]);
        const loadedCourses = coursesRes.courses ?? [];
        setDepartments(deptsRes.departments ?? []);
        setCourses(loadedCourses);
        const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
        setYears(selectableYears(configured, loadedCourses));
      } catch {
        toast({ variant: "destructive", title: "Failed to load filter options" });
      }
    })();
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/college/incident-reports");
      const json = await res.json() as { reports?: IncidentReport[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load incident reports" });
        return;
      }
      setReports(json.reports ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load incident reports" });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  function openHistory() {
    setView("history");
    void loadHistory();
  }

  // Unchecking a type hides its section AND drops what was picked in it, so a
  // hidden selection can never leak into the saved report.
  function toggleStudents(checked: boolean) {
    setIncludeStudents(checked);
    if (!checked) setStudents({});
  }
  function toggleFaculty(checked: boolean) {
    setIncludeFaculty(checked);
    if (!checked) setFaculty({});
  }

  const studentCount = includeStudents ? Object.keys(students).length : 0;
  const facultyCount = includeFaculty ? Object.keys(faculty).length : 0;
  const today = useMemo(() => todayInputValue(), []);

  function reset() {
    setIncludeStudents(false);
    setIncludeFaculty(false);
    setStudents({});
    setFaculty({});
    setIncidentDate("");
    setTitle("");
    setDescription("");
    setErrors({});
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!includeStudents && !includeFaculty) next.people = "Select Student and/or Faculty, then choose who was affected.";
    else if (studentCount + facultyCount === 0) next.people = "Select at least one affected student or faculty member.";
    if (!incidentDate) next.date = "Incident date is required.";
    else if (incidentDate > today) next.date = "Incident date cannot be in the future.";
    if (!title.trim()) next.title = "Incident title is required.";
    if (!description.trim()) next.description = "Incident description is required.";
    return next;
  }

  async function save() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/incident-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentDate,
          title: title.trim(),
          description: description.trim(),
          studentIds: includeStudents ? Object.keys(students) : [],
          facultyIds: includeFaculty ? Object.keys(faculty) : [],
        }),
      });
      const json = await res.json().catch(() => ({})) as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to save incident report" });
        return;
      }
      toast({ variant: "success", title: "Incident report saved" });
      reset();
      setReports(null); // History re-reads on next open
    } catch {
      toast({ variant: "destructive", title: "Failed to save incident report" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident Record"
        description={view === "form" ? "One place to document incidents and keep every record organized." : "Previously saved incident reports"}
        actions={
          view === "form" ? (
            <Button type="button" variant="outline" size="icon" title="History" aria-label="History" onClick={openHistory}>
              <History className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => setView("form")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />New report
            </Button>
          )
        }
      />

      {view === "form" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Incident details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="incident-date">Incident Date <span className="text-destructive">*</span></Label>
                  <Input id="incident-date" type="date" value={incidentDate} max={today} onChange={(e) => setIncidentDate(e.target.value)} />
                  {errors.date && <p className="text-xs text-destructive" role="alert">{errors.date}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="incident-title">Incident Title <span className="text-destructive">*</span></Label>
                  <Input id="incident-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of the incident" />
                  {errors.title && <p className="text-xs text-destructive" role="alert">{errors.title}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="incident-description">Incident Description <span className="text-destructive">*</span></Label>
                <Textarea
                  id="incident-description"
                  rows={6}
                  value={description}
                  maxLength={MAX_DESCRIPTION}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Give a detailed account of what happened"
                />
                {errors.description && <p className="text-xs text-destructive" role="alert">{errors.description}</p>}
              </div>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Choose the category to get started. You can pick both.</p>
                <div className="grid gap-4 sm:grid-cols-2" role="group" aria-label="Affected category">
                  {([
                    { label: "Student", Icon: GraduationCap, on: includeStudents, toggle: toggleStudents },
                    { label: "Faculty", Icon: Users, on: includeFaculty, toggle: toggleFaculty },
                  ] as const).map(({ label, Icon, on, toggle }) => (
                    <button
                      key={label}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(!on)}
                      className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-4 py-6 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        on ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {label}
                    </button>
                  ))}
                </div>

                {includeStudents && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Students</h3>
                    <IncidentStudentPicker departments={departments} courses={courses} years={years} selected={students} onChange={setStudents} />
                  </section>
                )}
                {includeFaculty && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Faculty</h3>
                    <IncidentFacultyPicker departments={departments} courses={courses} selected={faculty} onChange={setFaculty} />
                  </section>
                )}
                {errors.people && <p className="text-sm text-destructive" role="alert">{errors.people}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" onClick={() => void save()} loading={isSaving}>Save Incident Report</Button>
                <Button type="button" variant="outline" onClick={reset} disabled={isSaving}>Reset</Button>
                {studentCount + facultyCount > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {studentCount > 0 && `${studentCount} student${studentCount === 1 ? "" : "s"}`}
                    {studentCount > 0 && facultyCount > 0 && ", "}
                    {facultyCount > 0 && `${facultyCount} faculty`} selected
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {historyLoading && reports === null ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading reports...</p>
            ) : !reports || reports.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No incident reports saved yet.</p>
            ) : (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5">Title</th>
                        <th className="px-4 py-2.5">Incident Date</th>
                        <th className="px-4 py-2.5">Affected</th>
                        <th className="px-4 py-2.5">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {reports.map((r) => (
                        <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenReport(r)}>
                          <td className="px-4 py-3 font-medium">{r.title}</td>
                          <td className="px-4 py-3">{formatIncidentDate(r.incidentDate)}</td>
                          <td className="px-4 py-3"><Badge variant="secondary">{TYPE_LABELS[r.affectedType]}</Badge></td>
                          <td className="px-4 py-3 text-muted-foreground">{formatSubmitted(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y sm:hidden">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="w-full space-y-1 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpenReport(r)}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-medium">{r.title}</span>
                          <Badge variant="secondary">{TYPE_LABELS[r.affectedType]}</Badge>
                        </span>
                        <span className="block text-xs text-muted-foreground">Incident: {formatIncidentDate(r.incidentDate)}</span>
                        <span className="block text-xs text-muted-foreground">Submitted: {formatSubmitted(r.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={openReport !== null} onOpenChange={(o) => { if (!o) setOpenReport(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {openReport && (
            <>
              <DialogHeader>
                <DialogTitle>{openReport.title}</DialogTitle>
                <DialogDescription>Incident report</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Incident Date</dt><dd className="font-medium">{formatIncidentDate(openReport.incidentDate)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Affected</dt><dd className="font-medium">{TYPE_LABELS[openReport.affectedType]}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Submitted</dt><dd className="font-medium">{formatSubmitted(openReport.createdAt)}</dd></div>
              </dl>

              {openReport.students.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-sm font-semibold">Students ({openReport.students.length})</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Regd. No.</th><th className="px-3 py-2">Course</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Year</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {openReport.students.map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-medium">{s.name}</td>
                            <td className="px-3 py-2">{s.rollNumber}</td>
                            <td className="px-3 py-2">{s.course || "-"}</td>
                            <td className="px-3 py-2">{s.department}</td>
                            <td className="px-3 py-2">{ordinalYear(s.year)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {openReport.faculty.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-sm font-semibold">Faculty ({openReport.faculty.length})</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Employee ID</th><th className="px-3 py-2">Department</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {openReport.faculty.map((f) => (
                          <tr key={f.id}>
                            <td className="px-3 py-2 font-medium">{f.name}</td>
                            <td className="px-3 py-2">{f.employeeId}</td>
                            <td className="px-3 py-2">{f.department}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="space-y-1.5">
                <h4 className="text-sm font-semibold">Description</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{openReport.description}</p>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
