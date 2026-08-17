"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Pencil, RefreshCw, Search, Users, CheckCircle2, Clock, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDateTime } from "@/lib/utils";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { Course, Department, ExamConfiguration, InternalExamMarksBatch, Section, Subject } from "@/types";

type Batch = InternalExamMarksBatch & { courseId?: string; courseName?: string };
type Entry = InternalExamMarksBatch["entries"][number];

// Sentinel for "All" at the Branch/Section/Subject filter levels — distinct
// from "" (which still means "nothing picked yet" and drives the existing
// disabled-until-parent-selected cascade). Course and Year keep their
// existing required, single-value selection; only these three lower levels
// gain an All option, per the request.
const ALL = "__ALL__";

function ordinalYear(year: number | undefined) {
  if (year == null) return "—";
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function PrincipalInternalMarksPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [allBatches, setAllBatches] = useState<Batch[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // Distinguishes "the load itself failed" from "the load succeeded and
  // genuinely found nothing" — a failed fetch (transient network/session
  // hiccup, dev-server restart mid-request, etc.) must never be silently
  // presented as "no marks found for this selection".
  const [loadError, setLoadError] = useState(false);

  const [courseName, setCourseName] = useState("");
  const [year, setYear] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");

  const [sections, setSections] = useState<Section[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);

  const [configByBatchId, setConfigByBatchId] = useState<Record<string, ExamConfiguration>>({});

  const [viewTarget, setViewTarget] = useState<{ batch: Batch; entry: Entry } | null>(null);
  const [editTarget, setEditTarget] = useState<{ batch: Batch; entry: Entry } | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadData() {
    setIsLoadingData(true);
    setLoadError(false);
    try {
      const [courseRes, deptRes, subjectRes, batchRes] = await Promise.all([
        fetch("/api/college/courses"),
        fetch("/api/college/departments"),
        fetch("/api/college/subjects"),
        fetch("/api/college/internal-exam-marks"),
      ]);
      // Every one of these must actually succeed — a fetch resolving with a
      // non-2xx status (401 from a stale session, 500 from a dev-server
      // hiccup, etc.) does NOT throw, so without this check a failed load
      // silently falls through to "no marks found for this selection"
      // instead of a real error the user can act on.
      if (!courseRes.ok || !deptRes.ok || !subjectRes.ok || !batchRes.ok) {
        throw new Error("One or more requests failed");
      }
      const courseJson = (await courseRes.json()) as { courses?: Course[] };
      const deptJson = (await deptRes.json()) as { departments?: Department[] };
      const subjectJson = (await subjectRes.json()) as { subjects?: Subject[] };
      const batchJson = (await batchRes.json()) as { batches?: Batch[] };
      setCourses(courseJson.courses ?? []);
      setDepartments(deptJson.departments ?? []);
      setSubjects(subjectJson.subjects ?? []);
      setAllBatches(batchJson.batches ?? []);
    } catch {
      setLoadError(true);
      toast({ variant: "destructive", title: "Failed to load internal marks data" });
    } finally {
      setIsLoadingData(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await loadData();
    })();
  }, []);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);

  // A department "offers" Course + Year only when both are true: it has a
  // Course row for this course name (Course Catalog setup), AND it has
  // actually opened that year for teaching - resolveDepartmentCourseScope,
  // per-course override included, never a direct `assignedYears` read.
  const departmentById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  // The union of every department's actually-assigned years for this course
  // name, not the raw 1..max(durationYears) span - Department isn't picked
  // yet at this point in the flow (Course -> Year -> Branch), so a single
  // department's own scope can't be intersected here the way other pages do;
  // instead a year only appears at all if SOME department offering this
  // course actually teaches it. Falls back to the full span only when no
  // department has any explicit assignment, so an unconfigured college isn't
  // locked out.
  const yearOptions = useMemo(() => {
    const relevant = courses.filter((c) => c.name === courseName);
    const assigned = new Set<number>();
    for (const c of relevant) {
      const dept = departmentById.get(c.departmentId);
      if (!dept) continue;
      for (const y of resolveDepartmentCourseScope(dept, c.catalogId).assignedYears) assigned.add(y);
    }
    if (assigned.size > 0) return Array.from(assigned).sort((a, b) => a - b);
    const duration = Math.max(0, ...relevant.map((c) => c.durationYears));
    return Array.from({ length: duration }, (_, i) => i + 1);
  }, [courses, courseName, departmentById]);

  const branchOptions = useMemo(() => {
    if (!courseName || !year) return [];
    const yearNum = Number(year);
    const seen = new Map<string, string>();
    courses
      .filter((c) => c.name === courseName)
      .forEach((c) => {
        const dept = departmentById.get(c.departmentId);
        if (!dept) return;
        const assignedYears = resolveDepartmentCourseScope(dept, c.catalogId).assignedYears;
        if (!assignedYears.includes(yearNum)) return;
        seen.set(dept.id, dept.name);
      });
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [courses, courseName, year, departmentById]);

  // Every department-specific Course row sharing this course name — a
  // "Course" (e.g. "Bachelors of Technology") exists as one row per
  // department, so this is the set to match against whenever Department is
  // "All", and a single-element view of it whenever a specific department is
  // picked (department filtering happens separately below via each record's
  // own `department` name field, not by narrowing this set).
  const matchingCourses = useMemo(() => courses.filter((c) => c.name === courseName), [courses, courseName]);
  const matchingCourseIds = useMemo(() => new Set(matchingCourses.map((c) => c.id)), [matchingCourses]);

  const branchName = departmentId && departmentId !== ALL ? (departmentById.get(departmentId)?.name ?? "") : "";

  // Sections for this course name + year, across every department that
  // offers it (Principal's session is college-wide, so omitting courseId
  // here returns the whole college's sections for that year) — filtered
  // client-side to the course actually selected. This is department-
  // agnostic on purpose: it's what lets "All" work at the Branch level
  // without a second fetch path, and the Branch/Section selects below still
  // narrow it to one department the same way they always did.
  useEffect(() => {
    void (async () => {
      if (!courseName || !year) { setSections([]); return; }
      setIsLoadingSections(true);
      try {
        const res = await fetch(`/api/college/sections?year=${year}`);
        const json = (await res.json()) as { sections?: Section[] };
        setSections((json.sections ?? []).filter((s) => matchingCourseIds.has(s.courseId)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoadingSections(false);
      }
    })();
  }, [courseName, year, matchingCourseIds]);

  // Distinct section names in scope: every department's when Branch is
  // "All", otherwise just the selected department's — same section-name
  // values `sectionName` state has always held.
  const sectionOptions = useMemo(() => {
    if (!departmentId) return [];
    const inScope = departmentId === ALL ? sections : sections.filter((s) => s.department === branchName);
    return [...new Set(inScope.map((s) => s.name))].sort();
  }, [sections, departmentId, branchName]);

  const subjectOptions = useMemo(() => {
    if (!courseName || !year || !departmentId) return [];
    return subjects.filter(
      (s) =>
        matchingCourseIds.has(s.courseId ?? "") &&
        s.year === Number(year) &&
        (departmentId === ALL || s.department === branchName)
    );
  }, [subjects, courseName, year, departmentId, branchName, matchingCourseIds]);

  function resetDownstream(from: "course" | "year" | "branch" | "section") {
    if (from === "course") { setYear(""); setDepartmentId(""); setSectionName(""); setSubjectId(""); setSections([]); }
    if (from === "year") { setDepartmentId(""); setSectionName(""); setSubjectId(""); setSections([]); }
    if (from === "branch") { setSectionName(""); setSubjectId(""); }
    if (from === "section") { setSubjectId(""); }
  }

  // Batches carry `department` (a name) and `courseId` (joined server-side from
  // the Exam Cell's ExamConfiguration) but not a separate section/subject id
  // pairing beyond what's already on the batch. Whichever of Branch/Section/
  // Subject is "All" simply skips that one constraint — this runs against
  // `allBatches`, the Principal's real, already-loaded, unscoped batch list,
  // so "All" actually queries every matching existing record, not just a
  // label change.
  const matchingBatches = useMemo(() => {
    if (!courseName || !year || !departmentId || !sectionName || !subjectId) return [];
    return allBatches.filter((b) => {
      if (!matchingCourseIds.has(b.courseId ?? "")) return false;
      if (b.year !== Number(year)) return false;
      if (departmentId !== ALL && b.department !== branchName) return false;
      if (sectionName !== ALL && b.sectionName !== sectionName) return false;
      if (subjectId !== ALL && b.subjectId !== subjectId) return false;
      return true;
    });
  }, [allBatches, courseName, year, departmentId, branchName, sectionName, subjectId, matchingCourseIds]);

  // Any level set to "All" means matchingBatches can span multiple distinct
  // (department, section, subject) contexts at once, so it's rendered as one
  // flat, fully-labeled table instead of the single per-batch block used
  // when every level pins to one exact record.
  const isAllMode = departmentId === ALL || sectionName === ALL || subjectId === ALL;

  const flatRows = useMemo(() => {
    if (!isAllMode) return [];
    return matchingBatches
      .flatMap((batch) => batch.entries.filter(matchesSearch).map((entry) => ({ batch, entry })))
      .sort((a, b) =>
        a.batch.department.localeCompare(b.batch.department) ||
        a.batch.sectionName.localeCompare(b.batch.sectionName) ||
        a.batch.subjectName.localeCompare(b.batch.subjectName) ||
        a.entry.name.localeCompare(b.entry.name)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllMode, matchingBatches, search]);

  // Exam Cell configuration is fetched lazily per batch (once) rather than for
  // every batch up front, and re-fetched fresh each time a batch is opened so
  // an Exam Cell edit is reflected immediately.
  async function ensureConfig(batch: Batch): Promise<ExamConfiguration | null> {
    try {
      const res = await fetch(`/api/college/exam-configurations?subjectId=${encodeURIComponent(batch.subjectId)}`);
      const json = (await res.json()) as { configuration?: ExamConfiguration | null };
      if (json.configuration) {
        setConfigByBatchId((prev) => ({ ...prev, [batch.id]: json.configuration! }));
        return json.configuration;
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load marks breakdown" });
    }
    return null;
  }

  useEffect(() => {
    matchingBatches.forEach((b) => { if (!configByBatchId[b.id]) void ensureConfig(b); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingBatches]);

  function activeComponentsFor(batch: Batch) {
    const config = configByBatchId[batch.id];
    if (!config) return [];
    return [...config.components].filter((c) => c.isActive).sort((a, b) => a.order - b.order);
  }

  function entryTotal(batch: Batch, entry: Entry): number {
    return activeComponentsFor(batch).reduce((sum, c) => sum + (entry.componentMarks[c.id] ?? 0), 0);
  }

  function matchesSearch(entry: Entry): boolean {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return entry.name.toLowerCase().includes(q) || entry.rollNumber.toLowerCase().includes(q);
  }

  // Institution-wide, independent of the current filter selection.
  const totalStudents = allBatches.reduce((sum, b) => sum + b.totalStudents, 0);
  const submittedCount = allBatches.filter((b) => b.status === "SUBMITTED").length;
  const pendingCount = allBatches.filter((b) => b.status === "DRAFT").length;
  const averagePercent = (() => {
    const submitted = allBatches.filter((b) => b.status === "SUBMITTED" && configByBatchId[b.id]);
    let sumPct = 0;
    let n = 0;
    for (const b of submitted) {
      const config = configByBatchId[b.id];
      if (!config || config.internalMaxMarks <= 0) continue;
      for (const e of b.entries) {
        sumPct += (entryTotal(b, e) / config.internalMaxMarks) * 100;
        n += 1;
      }
    }
    return n > 0 ? Math.round(sumPct / n) : null;
  })();

  function openView(batch: Batch, entry: Entry) {
    setViewTarget({ batch, entry });
    if (!configByBatchId[batch.id]) void ensureConfig(batch);
  }

  async function openEdit(batch: Batch, entry: Entry) {
    const config = configByBatchId[batch.id] ?? (await ensureConfig(batch));
    if (!config) return;
    setEditTarget({ batch, entry });
    setEditError(null);
    setEditValues(
      Object.fromEntries(
        [...config.components].filter((c) => c.isActive).map((c) => [c.id, entry.componentMarks[c.id] == null ? "" : String(entry.componentMarks[c.id])])
      )
    );
  }

  function handleEditValueChange(componentId: string, raw: string, maxMarks: number, label: string) {
    setEditValues((v) => ({ ...v, [componentId]: raw }));
    const n = Number(raw);
    if (raw.trim() && (!Number.isFinite(n) || n < 0 || n > maxMarks)) {
      setEditError(`Maximum allowed marks for ${label} is ${maxMarks}.`);
    } else {
      setEditError(null);
    }
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    const config = configByBatchId[editTarget.batch.id];
    if (!config) return;
    const activeComponents = [...config.components].filter((c) => c.isActive);
    for (const c of activeComponents) {
      const raw = editValues[c.id];
      const n = Number(raw);
      if (raw?.trim() && (!Number.isFinite(n) || n < 0 || n > c.maxMarks)) {
        setEditError(`Maximum allowed marks for ${c.name} is ${c.maxMarks}.`);
        return;
      }
    }
    setIsSaving(true);
    try {
      const componentMarks = Object.fromEntries(
        activeComponents.map((c) => {
          const raw = editValues[c.id];
          return [c.id, raw?.trim() ? Number(raw) : null];
        })
      );
      const res = await fetch(`/api/college/internal-exam-marks/${editTarget.batch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ studentId: editTarget.entry.studentId, componentMarks }] }),
      });
      const json = (await res.json()) as { batch?: Batch; error?: string };
      if (!res.ok || !json.batch) throw new Error(json.error ?? "Failed to save changes");
      // PATCH returns the raw Firestore document — it never carries
      // courseId/courseName, since those are synthesized client-side only by
      // the initial list load (joined from the Exam Cell's ExamConfiguration,
      // never persisted on the batch itself). Replacing the batch outright
      // with the PATCH response would silently drop that enrichment and make
      // matchingBatches' `matchingCourseIds.has(b.courseId)` filter fail,
      // vanishing the just-edited record from the current selection. Merge
      // over the previous object instead so every real field the server
      // returns (entries, enteredCount, lastModifiedBy, ...) updates, while
      // client-only fields the server never sends are preserved.
      setAllBatches((prev) => prev.map((b) => (b.id === json.batch!.id ? { ...b, ...json.batch! } : b)));
      toast({ variant: "success", title: `Marks updated for ${editTarget.entry.name}` });
      setEditTarget(null);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save changes" });
    } finally {
      setIsSaving(false);
    }
  }

  const summaryCards = [
    { label: "Total Students", value: totalStudents, icon: Users, tile: "bg-blue-50 text-blue-600" },
    { label: "Submitted", value: submittedCount, icon: CheckCircle2, tile: "bg-emerald-50 text-emerald-600" },
    { label: "Pending", value: pendingCount, icon: Clock, tile: "bg-amber-50 text-amber-600" },
    { label: "Average Internal Marks", value: averagePercent != null ? `${averagePercent}%` : "—", icon: BarChart3, tile: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Marks"
        description="Institution-wide internal assessment management"
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={isLoadingData}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Failed to load Internal Marks data — this is a connection/loading problem, not an indication that no marks exist.
          </span>
          <Button variant="outline" size="sm" onClick={() => void loadData()}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summaryCards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${c.tile}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{isLoadingData ? "—" : c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter Internal Marks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
              <Label>Year</Label>
              <Select value={year} onValueChange={(v) => { setYear(v); resetDownstream("year"); }} disabled={!courseName}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch / Department</Label>
              <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); resetDownstream("branch"); }} disabled={!year}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branchOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No branches offer this course</div>
                  ) : (
                    <SelectItem value={ALL}>All Departments</SelectItem>
                  )}
                  {branchOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Section</Label>
              <Select value={sectionName} onValueChange={(v) => { setSectionName(v); resetDownstream("section"); }} disabled={!departmentId || isLoadingSections}>
                <SelectTrigger><SelectValue placeholder={isLoadingSections ? "Loading…" : "Select section"} /></SelectTrigger>
                <SelectContent>
                  {sectionOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No sections found</div>
                  ) : (
                    <SelectItem value={ALL}>All Sections</SelectItem>
                  )}
                  {sectionOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId} disabled={!sectionName}>
                <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {subjectOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects found</div>
                  ) : (
                    <SelectItem value={ALL}>All Subjects</SelectItem>
                  )}
                  {subjectOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!loadError && subjectId && matchingBatches.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No internal exam marks found for this selection — either no faculty has been assigned to teach it yet,
            or marks entry hasn&rsquo;t started.
          </CardContent>
        </Card>
      )}

      {!isAllMode && matchingBatches.map((batch) => {
        const config = configByBatchId[batch.id];
        const activeComponents = activeComponentsFor(batch);
        const visibleEntries = batch.entries.filter(matchesSearch);
        return (
          <div key={batch.id} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {courseName} • {ordinalYear(Number(year))} • {branchName} • Section {sectionName}
              </h2>
              <p className="text-xs text-muted-foreground">
                Subject: {batch.subjectName} ({batch.subjectCode}) — Internal Exam
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                Faculty: <strong>{batch.facultyName}</strong>
                <span className="mx-1 text-blue-300">|</span>
                Internal Maximum: <strong>{config ? config.internalMaxMarks : "—"}</strong>
                <span className="mx-1 text-blue-300">|</span>
                Students: <strong>{batch.totalStudents}</strong>
              </span>
              <Badge variant={batch.status === "SUBMITTED" ? "approved" : "pending"}>
                {batch.status === "SUBMITTED" ? "Submitted" : "Pending"}
              </Badge>
            </div>

            <div className="relative sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by student name or roll number"
                className="pl-9"
              />
            </div>

            {!config ? (
              <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Roll No.</th>
                        <th className="px-4 py-3">Student</th>
                        {activeComponents.map((c) => (
                          <th key={c.id} className="px-4 py-3 whitespace-nowrap">{c.name} (Max {c.maxMarks})</th>
                        ))}
                        <th className="px-4 py-3">Total</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {visibleEntries.map((entry) => (
                        <tr key={entry.studentId}>
                          <td className="px-4 py-2.5">{entry.rollNumber}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{entry.name}</td>
                          {activeComponents.map((c) => (
                            <td key={c.id} className="px-4 py-2.5">{entry.componentMarks[c.id] ?? "—"}/{c.maxMarks}</td>
                          ))}
                          <td className="px-4 py-2.5 font-semibold text-foreground">{entryTotal(batch, entry)}/{config.internalMaxMarks}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant={batch.status === "SUBMITTED" ? "approved" : "pending"} className="text-xs">
                              {batch.status === "SUBMITTED" ? "Submitted" : "Pending"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openView(batch, entry)}>
                                <Eye className="h-3.5 w-3.5" /> View
                              </Button>
                              {batch.status === "SUBMITTED" && (
                                <Button variant="ghost" size="sm" onClick={() => void openEdit(batch, entry)}>
                                  <Pencil className="h-3.5 w-3.5" /> Edit
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {visibleEntries.length === 0 && (
                        <tr>
                          <td colSpan={activeComponents.length + 5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                            No students match your search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        );
      })}

      {/* One or more of Branch/Section/Subject is "All" — matchingBatches can
          span multiple departments/sections/subjects at once, so every row
          carries its own identifying context instead of sharing one header. */}
      {isAllMode && (
        <div className="space-y-3">
          <div className="relative sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name or roll number"
              className="pl-9"
            />
          </div>

          {flatRows.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Course</th>
                      <th className="px-4 py-3">Year</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Faculty</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {flatRows.map(({ batch, entry }) => {
                      const config = configByBatchId[batch.id];
                      return (
                        <tr key={`${batch.id}-${entry.studentId}`}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-foreground">{entry.name}</p>
                            <p className="text-xs text-muted-foreground">{entry.rollNumber}</p>
                          </td>
                          <td className="px-4 py-2.5">{batch.department}</td>
                          <td className="px-4 py-2.5">{batch.courseName ?? courseName}</td>
                          <td className="px-4 py-2.5">{ordinalYear(batch.year)}</td>
                          <td className="px-4 py-2.5">{batch.sectionName}</td>
                          <td className="px-4 py-2.5">{batch.subjectName}</td>
                          <td className="px-4 py-2.5">{batch.facultyName}</td>
                          <td className="px-4 py-2.5 font-semibold text-foreground">
                            {config ? `${entryTotal(batch, entry)}/${config.internalMaxMarks}` : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={batch.status === "SUBMITTED" ? "approved" : "pending"} className="text-xs">
                              {batch.status === "SUBMITTED" ? "Submitted" : "Pending"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openView(batch, entry)}>
                                <Eye className="h-3.5 w-3.5" /> View
                              </Button>
                              {batch.status === "SUBMITTED" && (
                                <Button variant="ghost" size="sm" onClick={() => void openEdit(batch, entry)}>
                                  <Pencil className="h-3.5 w-3.5" /> Edit
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            matchingBatches.length > 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No students match your search.
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}

      {/* View — read-only detail */}
      <Dialog open={!!viewTarget} onOpenChange={(open) => !open && setViewTarget(null)}>
        <DialogContent className="max-w-lg">
          {viewTarget && (
            <>
              <DialogHeader>
                <DialogTitle>{viewTarget.entry.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><p className="text-xs text-muted-foreground">Roll Number</p><p className="font-medium">{viewTarget.entry.rollNumber}</p></div>
                  <div><p className="text-xs text-muted-foreground">Course</p><p className="font-medium">{viewTarget.batch.courseName ?? courseName} · {ordinalYear(viewTarget.batch.year)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Branch</p><p className="font-medium">{viewTarget.batch.department}</p></div>
                  <div><p className="text-xs text-muted-foreground">Section</p><p className="font-medium">{viewTarget.batch.sectionName}</p></div>
                  <div><p className="text-xs text-muted-foreground">Subject</p><p className="font-medium">{viewTarget.batch.subjectName}</p></div>
                  <div><p className="text-xs text-muted-foreground">Faculty</p><p className="font-medium">{viewTarget.batch.facultyName}</p></div>
                </div>

                <div className="rounded-md border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal Marks Breakdown</p>
                  {configByBatchId[viewTarget.batch.id] ? (
                    <div className="space-y-1.5">
                      {activeComponentsFor(viewTarget.batch).map((c) => (
                        <div key={c.id} className="flex justify-between">
                          <span className="text-muted-foreground">{c.name}</span>
                          <span className="font-medium">{viewTarget.entry.componentMarks[c.id] ?? "—"}/{c.maxMarks}</span>
                        </div>
                      ))}
                      <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                        <span>Total</span>
                        <span>{entryTotal(viewTarget.batch, viewTarget.entry)}/{configByBatchId[viewTarget.batch.id].internalMaxMarks}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3">
                  <div><p className="text-xs text-muted-foreground">Submission Status</p><p className="font-medium">{viewTarget.batch.status === "SUBMITTED" ? "Submitted" : "Pending"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Submitted At</p><p className="font-medium">{viewTarget.batch.submittedAt ? formatDateTime(viewTarget.batch.submittedAt) : "—"}</p></div>
                  {viewTarget.batch.lastModifiedByName && (
                    <>
                      <div><p className="text-xs text-muted-foreground">Last Modified By</p><p className="font-medium">{viewTarget.batch.lastModifiedByName}</p></div>
                      <div><p className="text-xs text-muted-foreground">Last Modified At</p><p className="font-medium">{viewTarget.batch.lastModifiedAt ? formatDateTime(viewTarget.batch.lastModifiedAt) : "—"}</p></div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit — Principal correction of already-submitted marks */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          {editTarget && configByBatchId[editTarget.batch.id] && (
            <>
              <DialogHeader>
                <DialogTitle>Edit Marks — {editTarget.entry.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {activeComponentsFor(editTarget.batch).map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <Label>{c.name}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={c.maxMarks}
                        value={editValues[c.id] ?? ""}
                        onChange={(e) => handleEditValueChange(c.id, e.target.value, c.maxMarks, c.name)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">/ {c.maxMarks}</span>
                    </div>
                  </div>
                ))}
                {editError && <p className="text-sm text-destructive">{editError}</p>}
                <div className="flex justify-between border-t pt-3 text-sm font-semibold">
                  <span>Total</span>
                  <span>
                    {activeComponentsFor(editTarget.batch).reduce((sum, c) => sum + (Number(editValues[c.id]) || 0), 0)}
                    {" / "}
                    {configByBatchId[editTarget.batch.id].internalMaxMarks}
                  </span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button onClick={() => void handleSaveEdit()} loading={isSaving} disabled={!!editError}>Save Changes</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
