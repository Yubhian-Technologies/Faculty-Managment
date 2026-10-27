"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { usePagination } from "@/hooks/usePagination";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, CourseYearTiming, Department, MidNumber, MidPaperAssignment, Subject, SubjectSemesterAssignment } from "@/types";
import type { MidBankListItem } from "@/lib/midBank/clientTypes";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { fedYears, regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { managerEffectiveYears, mergeOwnDepartmentOptions } from "@/lib/departments/hodScope";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { semesterInYearLabel } from "@/lib/academic/format";

interface FacultyOption { id: string; name: string }

// Filters work like HOD > Subjects: Course, Department (optional here - all of
// the HOD's departments by default), Year (the years this HOD's departments
// teach), Semester (from the course-year timings) and Regulation (optional, from
// the Course Catalog). The Subject list is the semester's assigned subjects
// (Academics > Curriculum > Assign) - never every subject of the course.
const ALL = "__all__"; // Radix Select items can't use an empty string value

export default function MidPaperSetterPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [currentSessionStart, setCurrentSessionStart] = useState<number | null>(null);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const myDepartments = useMyDepartments();

  const [courseKey, setCourseKey] = useState("");
  const [deptId, setDeptId] = useState(""); // "" = all of the HOD's departments
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [regulation, setRegulation] = useState(""); // "" = all regulations
  const [instances, setInstances] = useState<SubjectSemesterAssignment[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [midNumber, setMidNumber] = useState<MidNumber>(1);
  const [facultyId, setFacultyId] = useState("");

  // Set by the Load button (last in the filter row): the subject whose
  // teaching faculty were loaded. Faculty + Assign only appear for it, and any
  // filter change clears it.
  const [facultyLoadedFor, setFacultyLoadedFor] = useState("");
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [facultyOptions, setFacultyOptions] = useState<FacultyOption[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);

  const [assignments, setAssignments] = useState<MidPaperAssignment[]>([]);
  // Progress of each assignment's question bank (keyed by assignment id).
  const [progress, setProgress] = useState<Record<string, MidBankListItem>>({});
  const assignmentPager = usePagination(assignments, 10);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingCourses(true);
      try {
        const [cRes, dRes] = await Promise.all([fetch("/api/college/courses"), fetch("/api/college/departments")]);
        const data = (await cRes.json()) as { courses?: Course[] };
        const depts = (await dRes.json()) as { departments?: Department[] };
        setCourses((data.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setDepartments(depts.departments ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, []);

  async function loadAssignments() {
    setIsLoadingAssignments(true);
    try {
      const res = await fetch("/api/college/mid-paper-assignments");
      const data = (await res.json()) as { assignments?: MidPaperAssignment[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load assignments");
      setAssignments(data.assignments ?? []);
      fetch("/api/college/mid-question-banks?scope=department")
        .then((r) => (r.ok ? (r.json() as Promise<{ banks?: MidBankListItem[] }>) : { banks: [] }))
        .then((d) => setProgress(Object.fromEntries((d.banks ?? []).map((b) => [b.id, b]))))
        .catch(() => undefined);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load assignments" });
    } finally {
      setIsLoadingAssignments(false);
    }
  }

  useEffect(() => { void (async () => { await loadAssignments(); })(); }, []);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => undefined);
    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label: string; isCurrent: boolean }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((x) => x.isCurrent);
        setCurrentSessionStart(current ? parseAcademicYearStart(current.label) ?? null : null);
      })
      .catch(() => undefined);
  }, []);

  // One Course entry per programme (each department owns its own Course doc of it).
  const courseGroups = useMemo(() => {
    const groups = new Map<string, Course[]>();
    for (const c of courses) {
      const k = c.catalogId ?? `name:${c.name}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    return [...groups.entries()].map(([key, rows]) => ({ key, name: rows[0].name, rows }));
  }, [courses]);
  const group = courseGroups.find((g) => g.key === courseKey) ?? null;
  const groupCourseIds = useMemo(() => (group ? [...new Set(group.rows.map((c) => c.id))] : []), [group]);

  // The HOD's own department, its sub-departments and managed branches (as HOD > Subjects).
  const deptOptions = useMemo(() => mergeOwnDepartmentOptions(departments, myDepartments), [departments, myDepartments]);
  const course = group ? (group.rows.find((c) => c.departmentId === deptId) ?? group.rows[0]) : null;
  // Only the years this HOD's departments teach for the course - never every year.
  const yearOptions = useMemo(() => {
    if (!course) return [];
    const scope = deptId ? deptOptions.filter((d) => d.id === deptId) : deptOptions;
    const years = new Set<number>();
    for (const d of scope) {
      const fed = new Set(fedYears(d, departments, course.catalogId));
      for (const y of managerEffectiveYears(d, departments, course.catalogId)) if (!fed.has(y)) years.add(y);
    }
    return Array.from({ length: course.durationYears }, (_, k) => k + 1).filter((y) => years.has(y));
  }, [course, deptId, deptOptions, departments]);

  // Semesters of the chosen year, from the course-year timings of any of the programme's Course docs.
  useEffect(() => {
    if (!year || groupCourseIds.length === 0) { setTimings([]); return; }
    let cancelled = false;
    void Promise.all(groupCourseIds.map((id) =>
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
        .then((d) => (d.timings ?? []).filter((t) => t.year === Number(year)))
        .catch(() => [] as CourseYearTiming[])
    )).then((lists) => { if (!cancelled) setTimings(lists.flat()); });
    return () => { cancelled = true; };
  }, [year, groupCourseIds]);
  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const x of t.semesters ?? []) nums.add(x.semester);
    return [...nums].sort((a, b) => a - b);
  }, [timings]);

  const catalogItem = catalogItems.find((c) => c.id === course?.catalogId) ?? null;
  const regulationOptions = useMemo(() => {
    const fromCatalog = course?.catalogId && year
      ? regulationsForCourseYearByBatch(catalogItem?.regulationBatches ?? {}, Number(year), currentSessionStart ?? undefined, catalogItem?.regulations)
      : [];
    return [...new Set([...fromCatalog, ...instances.map((a) => a.regulation).filter((r): r is string => !!r)])].sort();
  }, [course, year, catalogItem, currentSessionStart, instances]);

  function resetDownstream(from: "course" | "dept" | "year" | "semester" | "regulation" | "subject") {
    setFacultyLoadedFor("");
    setFacultyOptions([]);
    setFacultyId("");
    if (from === "subject") return;
    setSubjectId("");
    if (from === "course") { setDeptId(""); setYear(""); setSemester(""); setRegulation(""); }
    if (from === "dept") { setYear(""); setSemester(""); }
    if (from === "year") setSemester("");
  }

  // The semester's assigned subjects (Academics > Curriculum > Assign): one Subject
  // Instance per department + semester, filed under each department's own Course doc,
  // so every Course doc of the programme is asked; the API keeps an HOD to their own departments.
  useEffect(() => {
    if (groupCourseIds.length === 0 || !year || !semester) { setInstances([]); return; }
    let cancelled = false;
    setIsLoadingSubjects(true);
    void Promise.all(groupCourseIds.map(async (id) => {
      const params = new URLSearchParams({ courseId: id, semester, year, ...(deptId ? { departmentId: deptId } : {}) });
      const res = await fetch(`/api/college/subject-semester-assignments?${params}`);
      if (!res.ok) return [];
      return ((await res.json()) as { assignments?: SubjectSemesterAssignment[] }).assignments ?? [];
    }))
      .then((lists) => { if (!cancelled) setInstances(lists.flat()); })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Failed to load subjects" }); })
      .finally(() => { if (!cancelled) setIsLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [groupCourseIds, year, semester, deptId]);

  // One entry per master subject (what a Mid assignment is keyed by), in curriculum order.
  const subjects = useMemo<Subject[]>(() => {
    const bySubject = new Map<string, SubjectSemesterAssignment>();
    for (const a of instances) {
      if (regulation && a.regulation && a.regulation !== regulation) continue;
      if (a.subjectId && !bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
    }
    const ordered = [...bySubject.values()].sort((a, b) => (a.serialNumber ?? 999) - (b.serialNumber ?? 999) || a.subjectCode.localeCompare(b.subjectCode));
    return ordered.map((a) => ({ id: a.subjectId, name: a.subjectName, code: a.subjectCode }) as Subject);
  }, [instances, regulation]);

  async function loadFaculty() {
    if (!subjectId) return;
    setIsLoadingFaculty(true);
    try {
      const params = new URLSearchParams({ subjectId, listFaculty: "true" });
      const res = await fetch(`/api/college/mid-paper-assignments?${params}`);
      const data = (await res.json()) as { faculty?: FacultyOption[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load faculty");
      setFacultyOptions(data.faculty ?? []);
      setFacultyLoadedFor(subjectId);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load faculty" });
    } finally {
      setIsLoadingFaculty(false);
    }
  }

  async function assign() {
    if (!subjectId) { toast({ variant: "destructive", title: "Select a subject" }); return; }
    if (!facultyId) { toast({ variant: "destructive", title: "Select a faculty member" }); return; }
    setIsAssigning(true);
    try {
      const res = await fetch("/api/college/mid-paper-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, midNumber, facultyId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to assign");
      toast({ variant: "success", title: `Mid ${midNumber} question bank assigned` });
      setFacultyId("");
      await loadAssignments();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to assign" });
    } finally {
      setIsAssigning(false);
    }
  }

  const selectedSubject = subjects.find((s) => s.id === subjectId);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Mid Paper Setter"
        description="Pick a subject and hand its Mid question-bank to one of the faculty currently teaching it. They'll see it on their own dashboard once assigned."
      />

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={courseKey} onValueChange={(v) => { setCourseKey(v); resetDownstream("course"); }} disabled={isLoadingCourses}>
              <SelectTrigger><SelectValue placeholder={isLoadingCourses ? "Loading…" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Department <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={deptId || ALL} onValueChange={(v) => { setDeptId(v === ALL ? "" : v); resetDownstream("dept"); }} disabled={!group}>
              <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {deptOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Year</Label>
            <Select value={year} onValueChange={(v) => { setYear(v); resetDownstream("year"); }} disabled={!group || yearOptions.length === 0}>
              <SelectTrigger><SelectValue placeholder={group && yearOptions.length === 0 ? "No years taught" : "Select year"} /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYearLabel(y)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Semester</Label>
            {year && semesterOptions.length === 0 ? (
              <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3">
                <span className="text-xs text-muted-foreground">Not configured for this year</span>
              </div>
            ) : (
              <Select value={semester} onValueChange={(v) => { setSemester(v); resetDownstream("semester"); }} disabled={!year}>
                <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                <SelectContent>
                  {semesterOptions.map((x) => <SelectItem key={x} value={String(x)}>{semesterInYearLabel(semesterOptions, x, { format: "short" })}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Regulation</Label>
            <Select value={regulation || ALL} onValueChange={(v) => { setRegulation(v === ALL ? "" : v); resetDownstream("regulation"); }} disabled={!year}>
              <SelectTrigger><SelectValue placeholder="All regulations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All regulations</SelectItem>
                {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={(v) => { setSubjectId(v); resetDownstream("subject"); }} disabled={!semester || isLoadingSubjects}>
              <SelectTrigger><SelectValue placeholder={isLoadingSubjects ? "Loading…" : "Select subject"} /></SelectTrigger>
              <SelectContent>
                {subjects.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects assigned to this semester</div>
                )}
                {subjects.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({x.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mid</Label>
            <RadioGroup value={String(midNumber)} onValueChange={(v) => { setMidNumber(Number(v) as MidNumber); setFacultyLoadedFor(""); }} className="flex gap-4 pt-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="1" id="mid-1" />
                <Label htmlFor="mid-1" className="font-normal">Mid 1</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="2" id="mid-2" />
                <Label htmlFor="mid-2" className="font-normal">Mid 2</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Load is LAST: it needs every filter above (course, semester,
              subject, mid), then fetches who is teaching that subject. */}
          <div className="sm:col-span-2 lg:col-span-4 flex justify-start">
            <Button
              variant="outline"
              onClick={() => void loadFaculty()}
              loading={isLoadingFaculty}
              disabled={!courseKey || !semester || !subjectId}
            >
              <Search className="h-4 w-4 mr-2" />{facultyLoadedFor === subjectId && subjectId ? "Reload Faculty" : "Load Faculty"}
            </Button>
          </div>

          {facultyLoadedFor === subjectId && subjectId ? (
            <>
              <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                <Label>Faculty <span className="font-normal text-muted-foreground">(currently teaching this subject)</span></Label>
                <Select value={facultyId} onValueChange={setFacultyId} disabled={isLoadingFaculty}>
                  <SelectTrigger><SelectValue placeholder="Select faculty" /></SelectTrigger>
                  <SelectContent>
                    {facultyOptions.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nobody is currently assigned to teach this subject</div>
                    )}
                    {facultyOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                <Button onClick={() => void assign()} loading={isAssigning} disabled={!subjectId || !facultyId}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign Mid {midNumber}{selectedSubject ? ` - ${selectedSubject.name}` : ""}
                </Button>
              </div>
            </>
          ) : (
            <p className="sm:col-span-2 lg:col-span-4 text-sm text-muted-foreground">
              Select the course, year, semester, subject and mid, then press Load Faculty to choose who sets the paper.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Current Assignments
          </h2>
          {isLoadingAssignments ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No mid papers assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {assignmentPager.pageItems.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                    <p className="text-xs text-muted-foreground">
                      Assigned to {a.facultyName}
                      {progress[a.id] && (progress[a.id].started
                        ? ` · ${progress[a.id].status === "COMPLETE" ? "Bank complete" : `${progress[a.id].completeCount} of ${progress[a.id].totalCount} questions done`}`
                        : " · Bank not started")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {progress[a.id]?.started && (
                      <Button asChild size="sm" variant="ghost"><Link href={`/hod/mid-paper-setter/${encodeURIComponent(a.id)}`}>View bank</Link></Button>
                    )}
                    <Badge variant="outline">Mid {a.midNumber}</Badge>
                  </div>
                </div>
              ))}
              <Pagination
                page={assignmentPager.page}
                pageSize={assignmentPager.pageSize}
                total={assignmentPager.total}
                onPageChange={assignmentPager.setPage}
                onPageSizeChange={assignmentPager.setPageSize}
                className="pt-2"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
