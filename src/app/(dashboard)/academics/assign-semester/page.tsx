"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowLeft as ArrowLeftIcon, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, CourseYearTiming, Department, Subject, SubjectSemesterAssignment } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// A master subject (Subject.catalogId + year, department-independent - see
// its own doc-comment in types/teaching.ts) can be mapped into a DIFFERENT
// semester by different departments - Physics might be Semester 1 for CSE
// and Semester 2 for ECE. That's a real many-to-many relationship, so it's
// its own collection (SubjectSemesterAssignment, doc id
// `${subjectId}_${departmentId}`) rather than a single field on Subject.
//
// Picker order: Department -> Course -> Year -> Regulation -> Semester. This
// is an ordinary department-scoped picker (Department's own courses only) -
// unlike Master Subjects' own Regulation-first picker, there's no need to
// resolve "which department's course doc" here, because the mapping this
// page creates is keyed by departmentId directly.
//
// Sub-department support: when a top-level department has children
// (e.g. Basic Science → BS-Chemistry, BS-Mathematics), the picker
// shows those children under the parent so subjects can be assigned
// to the specific sub-department, not just the parent.
export default function AssignToSemesterPage() {
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<SubjectSemesterAssignment[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [expandedDeptId, setExpandedDeptId] = useState<string | null>(null);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedRegulation, setSelectedRegulation] = useState("");
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  // Pagination
  const [masterPage, setMasterPage] = useState(1);
  const masterPageSize = 10;
  const [assignPage, setAssignPage] = useState(1);
  const assignPageSize = 10;

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => {
        const all = d.departments ?? [];
        setAllDepartments(all);
        const topLevel = all.filter((dept) => !dept.parentDepartmentId);
        setDepartments(topLevel.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => { /* non-critical - regulation list just stays empty */ });
  }, []);

  const catalogById = useMemo(() => new Map(catalogItems.map((c) => [c.id, c])), [catalogItems]);
  const selectedDepartment = useMemo(
    () => allDepartments.find((d) => d.id === selectedDepartmentId) ?? null,
    [allDepartments, selectedDepartmentId]
  );
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);

  // Build parent → children map for the department tree
  const childrenOf = useMemo(() => {
    const map = new Map<string, Department[]>();
    for (const d of allDepartments) {
      if (d.parentDepartmentId) {
        const list = map.get(d.parentDepartmentId) ?? [];
        list.push(d);
        map.set(d.parentDepartmentId, list);
      }
    }
    return map;
  }, [allDepartments]);

  // Whether the currently selected department is a child (sub-department)
  const isSubDept = selectedDepartmentId && allDepartments.some((d) => d.id === selectedDepartmentId && d.parentDepartmentId);

  // Get top-level department that the selected sub-dept belongs to (for expanding)
  const parentDeptId = selectedDepartment?.parentDepartmentId ?? null;

  const yearOptions = useMemo(() => {
    if (!selectedCourse) return [];
    return Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1);
  }, [selectedCourse]);

  const regulationOptions = useMemo(() => {
    if (!selectedCourse) return [];
    return catalogById.get(selectedCourse.catalogId ?? "")?.regulations ?? [];
  }, [selectedCourse, catalogById]);

  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : selectedSemester != null && semesterOptions.includes(selectedSemester)
      ? selectedSemester
      : semesterOptions[0];

  const loadCourses = useCallback(async (departmentId: string) => {
    setIsLoadingCourses(true);
    try {
      const dept = allDepartments.find((d) => d.id === departmentId);
      const courseDeptId = dept?.parentDepartmentId ?? departmentId;
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(courseDeptId)}`);
      const data = await res.json() as { courses?: Course[] };
      setCourses((data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      setIsLoadingCourses(false);
    }
  }, [allDepartments]);

  // Master Collection = every subject for this catalog course+year
  // (department-independent). Semester panel = this DEPARTMENT's own
  // mappings for that catalog+year, from the junction collection.
  const loadSubjectsAndTimings = useCallback(async (course: Course, departmentId: string, year: string) => {
    setIsLoadingSubjects(true);
    try {
      const catalogId = course.catalogId ?? "";
       const [subjectsRes, timingsRes, assignmentsRes] = await Promise.all([
        fetch(`/api/college/subjects?courseId=${encodeURIComponent(course.id)}&year=${encodeURIComponent(year)}`),
        fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(course.id)}`),
        fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(course.id)}&departmentId=${encodeURIComponent(departmentId)}`),
      ]);
      const subjectsData = await subjectsRes.json() as { subjects?: Subject[] };
      const timingsData = await timingsRes.json() as { timings?: CourseYearTiming[] };
      const assignmentsData = assignmentsRes ? await assignmentsRes.json() as { assignments?: SubjectSemesterAssignment[] } : { assignments: [] };
      setSubjects(subjectsData.subjects ?? []);
      setTimings((timingsData.timings ?? []).filter((t) => t.year === Number(year)));
      setAssignments(assignmentsData.assignments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    setSelectedCourseId("");
    setSelectedYear("");
    setSelectedRegulation("");
    setSelectedSemester(null);
    setCourses([]);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    void loadCourses(departmentId);
  }

  function toggleExpand(deptId: string) {
    setExpandedDeptId(expandedDeptId === deptId ? null : deptId);
  }

  function selectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedYear("");
    setSelectedRegulation("");
    setSelectedSemester(null);
    setSubjects([]);
    setAssignments([]);
    setTimings([]);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
  }

  function selectYear(year: string) {
    setSelectedYear(year);
    setSelectedSemester(null);
    setSearchText("");
    setMasterPage(1);
    setAssignPage(1);
    if (selectedCourse) void loadSubjectsAndTimings(selectedCourse, selectedDepartmentId, year);
  }

  async function setSubjectSemester(subject: Subject, semester: number | null) {
    if (!selectedCourse || !selectedDepartment) return;
    setSavingId(subject.id);
    setAssignPage(1);
    try {
      if (semester != null) {
        const res = await fetch("/api/college/subject-semester-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: subject.id,
            subjectName: subject.name,
            subjectCode: subject.code,
            catalogId: selectedCourse.catalogId,
            year: Number(selectedYear),
            departmentId: selectedDepartment.id,
            departmentName: selectedDepartment.name,
            courseId: selectedCourse.id,
            semester,
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to assign subject");
      } else {
        const res = await fetch(
          `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(subject.id)}&departmentId=${encodeURIComponent(selectedDepartment.id)}`,
          { method: "DELETE" }
        );
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to remove subject");
      }
      if (selectedCourse) await loadSubjectsAndTimings(selectedCourse, selectedDepartment.id, selectedYear);
      toast({ variant: "success", title: semester != null ? `Added to Semester ${semester}` : "Removed from semester" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update subject" });
    } finally {
      setSavingId(null);
    }
  }

  // Get the label to display for a department in the dropdown
  function deptLabel(dept: Department) {
    if (dept.parentDepartmentId) {
      const parent = allDepartments.find((d) => d.id === dept.parentDepartmentId);
      return `  ${dept.name}`; // indented for children
    }
    return dept.name;
  }

  const assignedSubjectIds = useMemo(() => new Set(assignments.map((a) => a.subjectId)), [assignments]);
  const subjectsInRegulation = useMemo(
    () => (selectedRegulation ? subjects.filter((s) => !s.regulation || s.regulation === selectedRegulation) : subjects),
    [subjects, selectedRegulation]
  );
  const masterPool = useMemo(
    () => subjectsInRegulation.filter((s) => !assignedSubjectIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [subjectsInRegulation, assignedSubjectIds]
  );
  const searchedMasterPool = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return masterPool;
    return masterPool.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [masterPool, searchText]);
  const semesterAssignments = useMemo(
    () => assignments.filter((a) => a.semester === effectiveSemester).sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    [assignments, effectiveSemester]
  );

  // Paginated slices
  const masterTotalPages = Math.max(1, Math.ceil(searchedMasterPool.length / masterPageSize));
  const paginatedMasterPool = searchedMasterPool.slice((masterPage - 1) * masterPageSize, masterPage * masterPageSize);
  const assignTotalPages = Math.max(1, Math.ceil(semesterAssignments.length / assignPageSize));
  const paginatedAssignments = semesterAssignments.slice((assignPage - 1) * assignPageSize, assignPage * assignPageSize);

  return (
    <div className="space-y-6">
      <PageHeader title="Assign to Semester" description="Map master subjects into a specific semester, per department" />

      {isLoading ? (
        <div className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
      ) : departments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No departments have been set up for this college yet.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={selectedDepartmentId} onValueChange={selectDepartment}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <div className="flex items-center gap-1.5">
                          {d.name}
                          {childrenOf.has(d.id) && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleExpand(d.id); }}
                              className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                              aria-label={expandedDeptId === d.id ? "Collapse" : "Expand"}
                            >
                              {expandedDeptId === d.id ? "▼" : "▶"}
                            </button>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                    {expandedDeptId && childrenOf.has(expandedDeptId) &&
                      childrenOf.get(expandedDeptId)!.map((child) => (
                        <SelectItem key={child.id} value={child.id} className="pl-4">
                          {child.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse} disabled={!selectedDepartment || isLoadingCourses}>
                  <SelectTrigger><SelectValue placeholder={isLoadingCourses ? "Loading…" : "Select course"} /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={selectedYear} onValueChange={selectYear} disabled={!selectedCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Regulation</Label>
                <Select value={selectedRegulation} onValueChange={setSelectedRegulation} disabled={!selectedYear || regulationOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder={regulationOptions.length ? "Select regulation" : "None assigned"} /></SelectTrigger>
                  <SelectContent>
                    {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Semester</Label>
                {selectedYear && semesterOptions.length === 0 ? (
                  <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3">
                    <span className="text-xs text-muted-foreground">No semesters configured for this year</span>
                  </div>
                ) : (
                  <Select
                    value={effectiveSemester != null ? String(effectiveSemester) : ""}
                    onValueChange={(v) => setSelectedSemester(Number(v))}
                    disabled={!selectedYear || semesterOptions.length === 0}
                  >
                    <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                    <SelectContent>
                      {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedDepartment && !isLoadingCourses && courses.length === 0 && (
            <p className="text-sm text-muted-foreground px-1">
              No courses have been set up for {selectedDepartment.name} yet.
            </p>
          )}

          {selectedYear && semesterOptions.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              This course-year has no semesters configured yet. Set them up in Course-Year Timings first.
            </div>
          )}

          {selectedYear && effectiveSemester != null && (
            isLoadingSubjects ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[1, 2].map((i) => <div key={i} className="h-40 rounded-lg border bg-muted/30 animate-pulse" />)}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3 space-y-2">
                    <CardTitle className="text-base">Master Collection</CardTitle>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search by name or code…"
                        className="pl-8 h-9"
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {masterPool.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        Nothing left to add - every master subject already has a semester for {selectedDepartment?.name ?? ""}.
                      </p>
                     ) : paginatedMasterPool.length === 0 ? (
                       <p className="text-sm text-muted-foreground text-center py-6">
                         No subjects match &quot;{searchText}&quot;.
                       </p>
                     ) : (
                       <>
                         <div className="space-y-2">
                           {paginatedMasterPool.map((s) => (
                             <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                               <div>
                                 <p className="text-sm font-medium">{s.name} <span className="text-muted-foreground">({s.code})</span></p>
                                 {s.regulation && <Badge variant="secondary" className="text-xs mt-1">{s.regulation}</Badge>}
                               </div>
                               <Button
                                 size="sm"
                                 variant="outline"
                                 loading={savingId === s.id}
                                 onClick={() => void setSubjectSemester(s, effectiveSemester)}
                               >
                                 Add<ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                               </Button>
                             </div>
                           ))}
                         </div>
                         <Pagination
                           page={masterPage}
                           pageSize={masterPageSize}
                           total={searchedMasterPool.length}
                           onPageChange={setMasterPage}
                           onPageSizeChange={() => {}}
                           disabled={false}
                         />
                       </>
                     )}
                   </CardContent>
                 </Card>

                 <Card>
                   <CardHeader className="pb-3"><CardTitle className="text-base">{isSubDept ? "Semester " + effectiveSemester + " - " + selectedDepartment?.name + " (sub-department)" : "Semester " + effectiveSemester + " - " + (selectedDepartment?.name ?? "")}</CardTitle></CardHeader>
                   <CardContent>
                     {paginatedAssignments.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No subjects assigned to this semester yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {semesterAssignments.map((a) => {
                          const subject = subjects.find((s) => s.id === a.subjectId);
                          return (
                            <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                              <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={savingId === a.subjectId}
                                onClick={() => void setSubjectSemester(subject ?? { id: a.subjectId } as Subject, null)}
                              >
                                <ArrowLeftIcon className="h-3.5 w-3.5 mr-1.5" />Remove
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
