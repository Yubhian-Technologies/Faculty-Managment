"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { exportToCSV } from "@/lib/utils";
import { formatPercent } from "@/lib/studentAttendance/percentage";
import { applyStudentFilters, NO_FILTERS, type StudentReportFilters } from "@/lib/studentAttendance/reportFilters";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { Course, Department, SectionListItem } from "@/types";
import { yearSemesterLabel } from "@/lib/academic/format";

const ALL = "__all__";
// Below this a student is in shortage; colours the percentages in the tables.
const SHORTAGE_PERCENT = 75;

// With two or more batches ticked, the list is split under a heading per batch
// (alphabetical, "Not assigned" last); with one or none it stays a single list,
// signalled by batch === null.
function groupByBatch<T extends { labBatch?: string }>(rows: T[], batches: string[] | null): { batch: string | null; rows: T[] }[] {
  if (!batches || batches.length < 2) return [{ batch: null, rows }];
  const names = Array.from(new Set(rows.map((r) => r.labBatch ?? ""))).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return names.map((batch) => ({ batch, rows: rows.filter((r) => (r.labBatch ?? "") === batch) }));
}

// Percentage as a coloured pill: green at/above the shortage line, amber within
// ten points under it, red below that.
function pctBadge(p: number | null, strong = false) {
  if (p == null) return <span className="text-muted-foreground">-</span>;
  const tone = p >= SHORTAGE_PERCENT ? "bg-green-100 text-green-800" : p >= SHORTAGE_PERCENT - 10 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return <span className={`inline-block min-w-14 rounded-full px-2 py-0.5 text-xs tabular-nums ${strong ? "font-semibold" : "font-medium"} ${tone}`}>{formatPercent(p)}</span>;
}

interface SubjectCol { subjectId: string; subjectName: string; subjectCode: string }
interface ReportStudent {
  studentId: string;
  rollNumber: string;
  name: string;
  labBatch?: string;
  absentDays?: number;
  bySubject: Record<string, { held: number; attended: number; percentage: number | null }>;
  overall: { held: number; attended: number; percentage: number | null };
}
type RangeMode = "daily" | "period" | "monthly" | "tillNow";
interface RangeChoice { mode: RangeMode; date: string; from: string; to: string; month: string }
const TILL_NOW: RangeChoice = { mode: "tillNow", date: "", from: "", to: "", month: "" };
const RANGE_LABELS: Record<RangeMode, string> = { daily: "Daily", period: "Period", monthly: "Monthly", tillNow: "Till now (overall)" };
interface SectionReport { section: SectionListItem; subjects: SubjectCol[]; students: ReportStudent[] }

// Student attendance report: Course -> Department -> Semester -> Section,
// every one mandatory ("All sections" is an explicit choice, never a blank),
// then Load Report. There is no Year filter - the semester carries it. Semesters
// are the running numbers the course-year timings store (year 1 = 1-2, year 2 =
// 3-4 ... year 4 = 7-8), so a department only offers the semesters of the years
// it actually has sections in: the freshman department 1-2, a core department
// 3-8. Shows each student's attendance % till today, per subject and overall,
// for the chosen section - or every section of that department/semester's year
// when "All sections" is picked. Options come from the one /api/college/sections
// call, which already returns only what the signed-in role may see (an HOD only
// gets their own department tree).
export function StudentAttendanceReportView({ title = "Student Attendance", scoped, onlyOwnYears }: {
  title?: string;
  /** The viewer only sees their own slice (an HOD, a class incharge): a filter level with a single option is picked for them and hidden. */
  scoped?: boolean;
  /** Offer only the semesters of years the viewer actually has a section in (a class incharge), not every semester the department runs. */
  onlyOwnYears?: boolean;
}) {
  const [sections, setSections] = useState<SectionListItem[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(true);
  const [courseDocs, setCourseDocs] = useState<Course[]>([]);
  const [pickedCourse, setCourse] = useState("");
  const [pickedDepartment, setDepartment] = useState("");
  // The running semester number as a string, e.g. "3".
  const [semesterKey, setSemesterKey] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [reports, setReports] = useState<SectionReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  // The last Load/Apply failure, kept on screen (a toast disappears in seconds
  // and is easy to miss) until the next attempt succeeds.
  const [loadError, setLoadError] = useState("");
  // What the report on screen was actually loaded/filtered with. The checkboxes
  // below are a DRAFT until "Apply filter" - editing them changes nothing yet.
  const [applied, setApplied] = useState<{ filters: StudentReportFilters; range: RangeChoice; hosteller: "yes" | "no" | null }>({ filters: NO_FILTERS, range: TILL_NOW, hosteller: null });
  const [absenteesOn, setAbsenteesOn] = useState(false);
  const [rangeOn, setRangeOn] = useState(false);
  const [range, setRange] = useState<RangeChoice>(TILL_NOW);
  const [subjectOn, setSubjectOn] = useState(false);
  const [pickedSubjects, setPickedSubjects] = useState<string[]>([]);
  const [batchOn, setBatchOn] = useState(false);
  const [pickedBatches, setPickedBatches] = useState<string[]>([]);
  const [departmentDocs, setDepartmentDocs] = useState<Department[]>([]);
  const [percentOn, setPercentOn] = useState(false);
  const [minPercent, setMinPercent] = useState("");
  const [maxPercent, setMaxPercent] = useState("");
  const [daysOn, setDaysOn] = useState(false);
  const [minDays, setMinDays] = useState("");
  const [hostellers, setHostellers] = useState(false);
  const [dayScholars, setDayScholars] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        if (!res.ok) throw new Error("Failed to load sections");
        const json = (await res.json()) as { sections?: SectionListItem[] };
        setSections((json.sections ?? []).filter((s) => !!s.id));
        // Course length (years) decides how far up the semester list goes. Best
        // effort: without it the list stops at the highest year with a section.
        try {
          const [c, d] = await Promise.all([
            fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
            fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
          ]);
          setCourseDocs(c.courses ?? []);
          setDepartmentDocs(d.departments ?? []);
        } catch { /* falls back to the sections' own years */ }
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoadingSections(false);
      }
    })();
  }, []);

  const courseKey = (s: SectionListItem) => s.courseName || s.courseId || "";
  const courses = useMemo(() => Array.from(new Set(sections.map(courseKey).filter(Boolean))).sort(), [sections]);
  // An HOD only sees their own tree, so a level with a single option is not a
  // choice: the Course filter appears only when there are several courses, the
  // Department filter only when there are sub-departments. Everyone else (the
  // Principal) always picks explicitly.
  const only = <T,>(options: T[], picked: T | ""): T | "" => (picked !== "" ? picked : scoped && options.length === 1 ? options[0] : "");
  const course = only(courses, pickedCourse);
  const inCourse = useMemo(() => sections.filter((s) => courseKey(s) === course), [sections, course]);
  // Derived from the SECTIONS for an HOD/faculty, because /api/college/sections
  // is role-scoped and the departments list is not - building this from the
  // department list for them would show one HOD the whole college.
  //
  // Principal/College Office/College Admin see the college's real department
  // list instead. Deriving theirs from sections too meant a department with no
  // sections yet simply was not offered - Basic Science and its sub-departments
  // were missing from the picker at a college that plainly has them.
  const departments = useMemo(() => {
    const fromSections = Array.from(new Set(inCourse.map((s) => s.department).filter(Boolean)));
    if (scoped) return fromSections.sort();
    const all = departmentDocs
      .filter((d) => d.isActive !== false)
      .map((d) => (d.name ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set([...all, ...fromSections])).sort();
  }, [inCourse, departmentDocs, scoped]);
  const department = course ? only(departments, pickedDepartment) : "";
  const showCourse = !scoped || courses.length !== 1;
  const showDepartment = !scoped || departments.length !== 1;
  // A section's courseId can be a duplicate Course doc merged into the one the
  // courses API returns, so match on the merged ids and the names too.
  const courseOf = (x: SectionListItem) =>
    courseDocs.find((c) => c.id === x.courseId || c.mergedCourseIds?.includes(x.courseId)
      || (!!x.courseName && c.name.toLowerCase() === x.courseName.toLowerCase()));

  // Years are assigned per course where a department runs more than one, so
  // everything below resolves against the catalogue THIS course belongs to.
  // Read off the course's own sections (not the department's - a freshman
  // department may have none) and falling back to the picked course doc.
  const catalogId = useMemo(
    () => inCourse.map(courseOf).find((c) => !!c?.catalogId)?.catalogId
      ?? courseDocs.find((c) => c.name.toLowerCase() === course.toLowerCase())?.catalogId,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inCourse, courseDocs, course]
  );

  const deptDoc = useMemo(() => departmentDocs.find((d) => d.name === department), [departmentDocs, department]);

  // The years this department actually runs, per Principal/College Admin's
  // Departments screen. A SUB-department almost never carries years of its own
  // - that screen will not let an HOD set them on a child - so they live on the
  // common parent (Basic Science holds year 1; Basic Science - English,
  // - Physics, - Chemistry all run that year under it). Falling back to the
  // parent is the same rule managerTeachingYears already applies in
  // lib/departments/managedBranches.ts.
  const assignedYears = useMemo(() => {
    const yearsOf = (d: Department | undefined) =>
      d ? resolveDepartmentCourseScope(d, catalogId).assignedYears.filter((y) => Number.isFinite(y) && y >= 1) : [];
    const own = yearsOf(deptDoc);
    if (own.length > 0) return own;
    const parentDoc = deptDoc?.parentDepartmentId
      ? departmentDocs.find((d) => d.id === deptDoc.parentDepartmentId)
      : undefined;
    return yearsOf(parentDoc);
  }, [deptDoc, departmentDocs, catalogId]);

  // The sections this department's report covers. Normally just its own, but a
  // department that MANAGES branches for a shared year owns no sections under
  // its own name at all: Basic Science - Physics manages IT and ECE, and the
  // year-1 sections it runs are filed as "Information Technology" (BSP-IT-A).
  // Matching on the department name alone left every such picker empty.
  //
  // Borrowed sections are limited to the years the manager is assigned, so
  // Basic Science - Physics gets IT's year 1 and never IT's years 2-4, which
  // belong to IT's own HOD.
  const inDepartment = useMemo(() => {
    const own = inCourse.filter((x) => x.department === department);
    const managed = deptDoc?.managedDepartments ?? [];
    if (managed.length === 0 || assignedYears.length === 0) return own;
    const managedSet = new Set(managed);
    const yearSet = new Set(assignedYears);
    const borrowed = inCourse.filter(
      (x) => x.department !== department && managedSet.has(x.department) && yearSet.has(Number(x.year))
    );
    return [...own, ...borrowed];
  }, [inCourse, department, deptDoc, assignedYears]);

  // A department offers the semesters of the years it is assigned. One given
  // years 2-4 offers 2-1 .. 4-2 and never 1-1; a freshman department given only
  // year 1 offers 1-1 and 1-2.
  //
  // This used to span year 1 (or 2) up to the COURSE's duration and offer every
  // semester in between, so a department running one year still listed all
  // eight - the picker said far more than the department teaches.
  //
  // Falls back to the years its sections are actually in when nothing is
  // assigned - a department configured before assignedYears existed, or one
  // left blank, still gets a usable list instead of an empty one.
  const semesterOptions = useMemo(() => {
    const sectionYears = Array.from(new Set(
      inDepartment.map((x) => Number(x.year)).filter((y) => Number.isFinite(y) && y >= 1)
    ));
    let years = assignedYears.length > 0 ? assignedYears : sectionYears;
    if (years.length === 0) return [];
    // Faculty see only the years they personally hold a section in.
    if (onlyOwnYears) years = years.filter((y) => sectionYears.includes(y));

    return Array.from(new Set(years))
      .sort((a, b) => a - b)
      .flatMap((y) => [y * 2 - 1, y * 2].map((sem) => ({ key: String(sem), label: yearSemesterLabel(sem) })));
  }, [inDepartment, assignedYears, onlyOwnYears]);
  // Semester n belongs to year ceil(n / 2).
  const semesterYear = semesterKey ? Math.ceil(Number(semesterKey) / 2) : 0;
  const sectionOptions = useMemo(
    () => inDepartment.filter((x) => Number(x.year) === semesterYear).sort((a, b) => a.name.localeCompare(b.name)),
    [inDepartment, semesterYear]
  );

  // Any change to a filter invalidates the report already on screen.
  function reset() {
    setReports(null);
    setLoadError("");
    setApplied({ filters: NO_FILTERS, range: TILL_NOW, hosteller: null });
    setAbsenteesOn(false); setRangeOn(false); setRange(TILL_NOW);
    setSubjectOn(false); setPickedSubjects([]); setBatchOn(false); setPickedBatches([]);
    setPercentOn(false); setMinPercent(""); setMaxPercent(""); setDaysOn(false); setMinDays("");
    setHostellers(false); setDayScholars(false);
  }
  function pickCourse(v: string) { setCourse(v); setDepartment(""); setSemesterKey(""); setSectionId(""); reset(); }
  function pickDepartment(v: string) { setDepartment(v); setSemesterKey(""); setSectionId(""); reset(); }
  function pickSemester(v: string) { setSemesterKey(v); setSectionId(""); reset(); }
  function pickSection(v: string) { setSectionId(v); reset(); }

  const ready = !!course && !!department && !!semesterKey && !!sectionId;

  // Both or neither ticked means everyone; one narrows to that kind of student.
  const hostellerParam = hostellers === dayScholars ? null : hostellers ? "yes" : "no";

  async function fetchReports(r: RangeChoice, hosteller: "yes" | "no" | null): Promise<SectionReport[]> {
    const targets = sectionId === ALL ? sectionOptions : sectionOptions.filter((x) => x.id === sectionId);
    return Promise.all(targets.map(async (section): Promise<SectionReport> => {
      const params = new URLSearchParams({ sectionId: section.id, semester: semesterKey });
      if (r.mode === "daily") { params.set("from", r.date); params.set("to", r.date); }
      else if (r.mode === "period") { params.set("from", r.from); params.set("to", r.to); }
      else if (r.mode === "monthly") { params.set("from", `${r.month}-01`); params.set("to", `${r.month}-31`); }
      else params.set("tillNow", "true");
      if (hosteller) params.set("hosteller", hosteller);
      const res = await fetch(`/api/college/section-attendance-report?${params.toString()}`);
      const json = (await res.json()) as { subjects?: SubjectCol[]; students?: ReportStudent[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load report");
      return { section, subjects: json.subjects ?? [], students: json.students ?? [] };
    }));
  }

  async function load() {
    if (!ready) return;
    setLoading(true);
    setLoadError("");
    try {
      setReports(await fetchReports(TILL_NOW, null));
      setApplied({ filters: NO_FILTERS, range: TILL_NOW, hosteller: null });
    } catch (e) {
      setReports(null);
      const message = e instanceof Error ? e.message : "Failed to load report";
      setLoadError(message);
      toast({ variant: "destructive", title: message });
    } finally {
      setLoading(false);
    }
  }

  // Subjects and lab batches the filters can offer come from the loaded report.
  const subjectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reports ?? []) for (const s of r.subjects) m.set(s.subjectId, s.subjectName);
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [reports]);
  const batchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports ?? []) for (const s of r.students) set.add(s.labBatch ?? "");
    return Array.from(set).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [reports]);

  function toggle(list: string[], set: (v: string[]) => void, v: string, on: boolean) {
    set(on ? [...list, v] : list.filter((x) => x !== v));
  }

  async function applyFilter() {
    const chosen: RangeChoice = rangeOn ? range : TILL_NOW;
    if (chosen.mode === "daily" && !chosen.date) { toast({ variant: "destructive", title: "Pick the day" }); return; }
    if (chosen.mode === "period" && (!chosen.from || !chosen.to || chosen.from > chosen.to)) {
      toast({ variant: "destructive", title: "Pick a valid From and To date" }); return;
    }
    if (chosen.mode === "monthly" && !chosen.month) { toast({ variant: "destructive", title: "Pick the month" }); return; }
    const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    // A ticked filter with nothing filled in used to be silently skipped, which
    // looked like "Apply filter did nothing" - say what is missing instead.
    const missing =
      subjectOn && pickedSubjects.length === 0 ? "Tick at least one subject" :
      batchOn && pickedBatches.length === 0 ? "Tick at least one batch" :
      percentOn && num(minPercent) == null && num(maxPercent) == null ? "Enter a From % and/or To %" :
      percentOn && num(minPercent) != null && num(maxPercent) != null && num(minPercent)! > num(maxPercent)! ? "From % can't be more than To %" :
      daysOn && num(minDays) == null ? "Enter the number of days absent" : "";
    if (missing) { toast({ variant: "destructive", title: missing }); return; }
    const filters: StudentReportFilters = {
      absentees: absenteesOn,
      subjectIds: subjectOn && pickedSubjects.length > 0 ? pickedSubjects : null,
      batches: batchOn && pickedBatches.length > 0 ? pickedBatches : null,
      minPercent: percentOn ? num(minPercent) : null,
      maxPercent: percentOn ? num(maxPercent) : null,
      minAbsentDays: daysOn ? num(minDays) : null,
    };
    setLoading(true);
    setLoadError("");
    try {
      const fresh = await fetchReports(chosen, hostellerParam);
      setReports(fresh);
      setApplied({ filters, range: chosen, hosteller: hostellerParam });
      const count = fresh.reduce((n, r) => n + applyStudentFilters(r.students, filters).length, 0);
      toast({ title: `Filter applied - ${count} student${count === 1 ? "" : "s"}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to apply filter";
      setLoadError(message);
      toast({ variant: "destructive", title: message });
    } finally {
      setLoading(false);
    }
  }

  // The filtered view of what is loaded - exactly what the table shows and the CSV exports.
  const shownReports = useMemo(
    () => (reports ?? []).map((r) => ({
      ...r,
      columns: applied.filters.subjectIds ? r.subjects.filter((s) => applied.filters.subjectIds!.includes(s.subjectId)) : r.subjects,
      rows: applyStudentFilters(r.students, applied.filters),
    })),
    [reports, applied]
  );

  const rangeText = applied.range.mode === "daily" ? `Day ${applied.range.date}`
    : applied.range.mode === "period" ? `${applied.range.from} to ${applied.range.to}`
    : applied.range.mode === "monthly" ? `Month ${applied.range.month}`
    : "Till now";

  // One line saying exactly which filters the tables below are showing.
  const appliedChips = useMemo(() => {
    const f = applied.filters;
    const parts: string[] = [];
    if (f.absentees) parts.push("Absentees only");
    if (applied.range.mode !== "tillNow") parts.push(rangeText);
    if (f.subjectIds) parts.push(`Subjects: ${subjectOptions.filter((x) => f.subjectIds!.includes(x.id)).map((x) => x.name).join(", ")}`);
    if (f.batches) parts.push(`Batch: ${f.batches.map((b) => b || "Not assigned").join(", ")}`);
    if (f.minPercent != null || f.maxPercent != null) parts.push(`Attendance ${f.minPercent ?? 0}% to ${f.maxPercent ?? 100}%`);
    if (f.minAbsentDays != null) parts.push(`Absent ${f.minAbsentDays}+ days`);
    if (applied.hosteller) parts.push(applied.hosteller === "yes" ? "Hostellers" : "Day scholars");
    return parts;
  }, [applied, subjectOptions, rangeText]);

  function handleExport() {
    if (!reports) return;
    const rows: Record<string, string>[] = [];
    const subjectColumns = new Map<string, string>();
    for (const r of shownReports) {
      for (const sub of r.columns) subjectColumns.set(sub.subjectCode, sub.subjectName);
      for (const s of groupByBatch(r.rows, applied.filters.batches).flatMap((g) => g.rows)) {
        const row: Record<string, string> = { section: r.section.name, batch: s.labBatch || "Not assigned", rollNumber: s.rollNumber, name: s.name, absentDays: String(s.absentDays ?? 0) };
        for (const sub of r.columns) row[sub.subjectCode] = formatPercent(s.bySubject[sub.subjectId]?.percentage ?? null);
        row.percent = formatPercent(s.shown.percentage);
        rows.push(row);
      }
    }
    if (!rows.length) { toast({ variant: "destructive", title: "No data to export" }); return; }
    exportToCSV(rows, `student-attendance-${Date.now()}.csv`, [
      { key: "section", header: "Section" },
      ...(applied.filters.batches ? [{ key: "batch", header: "Batch" }] : []),
      { key: "rollNumber", header: "Registration No." },
      { key: "name", header: "Name" },
      ...Array.from(subjectColumns.entries()).map(([key, header]) => ({ key, header })),
      { key: "absentDays", header: "Days absent" },
      { key: "percent", header: "Overall %" },
    ]);
  }

  // Back to everyone, till now: clears every draft filter and reloads.
  async function clearFilters() {
    setAbsenteesOn(false); setRangeOn(false); setRange(TILL_NOW);
    setSubjectOn(false); setPickedSubjects([]); setBatchOn(false); setPickedBatches([]);
    setPercentOn(false); setMinPercent(""); setMaxPercent(""); setDaysOn(false); setMinDays("");
    setHostellers(false); setDayScholars(false);
    await load();
  }

  // Headline numbers for what the tables below currently show.
  const stats = useMemo(() => {
    let students = 0, withPercent = 0, sum = 0, low = 0;
    for (const r of shownReports) {
      for (const row of r.rows) {
        students += 1;
        const pct = row.shown.percentage;
        if (pct != null) { withPercent += 1; sum += pct; if (pct < SHORTAGE_PERCENT) low += 1; }
      }
    }
    return { students, sections: shownReports.length, average: withPercent ? sum / withPercent : null, low };
  }, [shownReports]);

  const filterTile = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, body?: React.ReactNode) => (
    <div className={`rounded-lg border p-3 transition-colors ${checked ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
      <div className="flex items-start gap-2.5">
        <Checkbox id={id} className="mt-0.5" checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        <div className="min-w-0">
          <Label htmlFor={id} className="cursor-pointer text-sm font-medium leading-none">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {checked && body && <div className="mt-3 space-y-2 border-t pt-3 sm:pl-6">{body}</div>}
    </div>
  );
  const optionRow = (id: string, label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div key={id} className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">{label}</Label>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">Pick a course, semester and section, load the report, then narrow it down with filters.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {isLoadingSections ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-md border bg-muted/30" />)}
            </div>
          ) : sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sections are available to you yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {showCourse && <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={course} onValueChange={pickCourse}>
                  <SelectTrigger><SelectValue placeholder="Select a course" /></SelectTrigger>
                  <SelectContent>{courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>}
              {showDepartment && <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={department} onValueChange={pickDepartment} disabled={!course}>
                  <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
                  <SelectContent>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>}
              <div className="space-y-1.5">
                <Label>Semester</Label>
                <Select value={semesterKey} onValueChange={pickSemester} disabled={!department}>
                  <SelectTrigger><SelectValue placeholder="Select a semester" /></SelectTrigger>
                  <SelectContent>{semesterOptions.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Section</Label>
                <Select value={sectionId} onValueChange={pickSection} disabled={!semesterKey}>
                  <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All sections</SelectItem>
                    {sectionOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}{s.batch ? ` · ${s.batch}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void load()} disabled={!ready || loading}>{loading && !reports ? "Loading…" : "Load Report"}</Button>
            {!ready && !isLoadingSections && sections.length > 0 && (
              <p className="text-xs text-muted-foreground">Choose a course, department, semester and section to load the report.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {reports && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
            <p className="text-xs text-muted-foreground">Tick the ones you want, fill them in, then press Apply filter.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filterTile("f-absentees", "Absentees only", "Students who missed at least one period", absenteesOn, setAbsenteesOn)}

              {filterTile("f-range", "Date range", "Daily, period, monthly or overall", rangeOn, setRangeOn, (
                <>
                  <Select value={range.mode} onValueChange={(v) => setRange({ ...range, mode: v as RangeMode })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RANGE_LABELS) as RangeMode[]).map((m) => <SelectItem key={m} value={m}>{RANGE_LABELS[m]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {range.mode === "daily" && <Input type="date" aria-label="Day" value={range.date} onChange={(e) => setRange({ ...range, date: e.target.value })} />}
                  {range.mode === "monthly" && <Input type="month" aria-label="Month" value={range.month} onChange={(e) => setRange({ ...range, month: e.target.value })} />}
                  {range.mode === "period" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                      <Input type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
                    </div>
                  )}
                </>
              ))}

              {filterTile("f-subject", "Subject-wise", "Show and calculate on chosen subjects only", subjectOn, setSubjectOn, (
                <>
                  {subjectOptions.length === 0 && <p className="text-xs text-muted-foreground">No subjects.</p>}
                  {subjectOptions.map((sub) => optionRow(`f-sub-${sub.id}`, sub.name, pickedSubjects.includes(sub.id), (on) => toggle(pickedSubjects, setPickedSubjects, sub.id, on)))}
                </>
              ))}

              {filterTile("f-batch", "Batch-wise", "Lab batch of the student", batchOn, setBatchOn, (
                <>{batchOptions.map((b) => optionRow(`f-batch-${b || "none"}`, b || "Not assigned", pickedBatches.includes(b), (on) => toggle(pickedBatches, setPickedBatches, b, on)))}</>
              ))}

              {filterTile("f-percent", "Attendance % range", "From and to, both inclusive", percentOn, setPercentOn, (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={0} max={100} placeholder="From %" aria-label="From %" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} />
                  <Input type="number" min={0} max={100} placeholder="To %" aria-label="To %" value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} />
                </div>
              ))}

              {filterTile("f-days", "Absent for days", "Whole days absent, at least this many", daysOn, setDaysOn, (
                <div className="flex items-center gap-2">
                  <Input type="number" min={1} className="w-24" aria-label="Days absent" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
                  <span className="text-sm text-muted-foreground">or more days</span>
                </div>
              ))}

              <div className="rounded-lg border bg-card p-3 md:col-span-2 xl:col-span-3">
                <p className="text-sm font-medium leading-none">Students</p>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  {optionRow("f-all", "All", hostellers === dayScholars, (on) => { if (on) { setHostellers(false); setDayScholars(false); } })}
                  {optionRow("f-host", "Hostellers", hostellers && !dayScholars, (on) => { setHostellers(on); if (on) setDayScholars(false); })}
                  {optionRow("f-day", "Day scholars", dayScholars && !hostellers, (on) => { setDayScholars(on); if (on) setHostellers(false); })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void applyFilter()} disabled={loading}>{loading ? "Applying…" : "Apply filter"}</Button>
              <Button variant="outline" onClick={() => void clearFilters()} disabled={loading}>Clear filters</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load the report: {loadError}
        </div>
      )}
      {loading && !reports && <div className="h-24 animate-pulse rounded-md border bg-muted/30" />}
      {reports && reports.length === 0 && (
        <p className="text-sm text-muted-foreground">There are no sections for this selection.</p>
      )}

      {reports && reports.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing:</span>
            {appliedChips.length === 0
              ? <Badge variant="secondary">Everyone · till now</Badge>
              : appliedChips.map((c) => <Badge key={c} variant="in_progress">{c}</Badge>)}
            {/* Hard right, directly above the tables it exports - and only
                rendered alongside a report, so it can never be the dead
                control it was while sitting next to Load Report. */}
            <Button className="ml-auto" onClick={handleExport}>
              Export CSV
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Students", value: String(stats.students) },
              { label: "Sections", value: String(stats.sections) },
              { label: "Average attendance", value: stats.average == null ? "-" : `${stats.average.toFixed(1)}%` },
              { label: `Below ${SHORTAGE_PERCENT}%`, value: String(stats.low), tone: stats.low > 0 ? "text-red-600" : "" },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone ?? ""}`}>{t.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {shownReports.map((r) => (
        <Card key={r.section.id} className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/30 py-3">
            <CardTitle className="text-base">Section {r.section.name}{r.section.batch ? <span className="ml-2 font-normal text-muted-foreground">{r.section.batch}</span> : null}</CardTitle>
            <span className="text-xs text-muted-foreground">{rangeText} · {r.rows.length} student{r.rows.length === 1 ? "" : "s"}</span>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-auto p-0">
            {r.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No students match these filters.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Reg. No.</th>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    {r.columns.map((s) => <th key={s.subjectId} className="whitespace-nowrap px-4 py-2.5 text-center font-medium">{s.subjectName}</th>)}
                    <th className="whitespace-nowrap px-4 py-2.5 text-center font-medium">Days absent</th>
                    <th className="whitespace-nowrap px-4 py-2.5 text-center font-medium">Overall</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {groupByBatch(r.rows, applied.filters.batches).map((g) => (
                    <Fragment key={g.batch ?? "all"}>
                      {g.batch != null && (
                        <tr className="bg-primary/5">
                          <th colSpan={r.columns.length + 4} scope="colgroup" className="px-4 py-2 text-left text-sm font-semibold">
                            {g.batch || "Not assigned"}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">{g.rows.length} student{g.rows.length === 1 ? "" : "s"}</span>
                          </th>
                        </tr>
                      )}
                      {g.rows.map((s) => (
                        <tr key={s.studentId} className="odd:bg-background even:bg-muted/20 hover:bg-muted/40">
                          <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{s.rollNumber}</td>
                          <td className="px-4 py-2.5 font-medium">{s.name}</td>
                          {r.columns.map((sub) => (
                            <td key={sub.subjectId} className="px-4 py-2.5 text-center">{pctBadge(s.bySubject[sub.subjectId]?.percentage ?? null)}</td>
                          ))}
                          <td className="px-4 py-2.5 text-center tabular-nums">{s.absentDays ?? 0}</td>
                          <td className="px-4 py-2.5 text-center">{pctBadge(s.shown.percentage, true)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
