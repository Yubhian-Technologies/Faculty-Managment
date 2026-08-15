"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Trash2, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { sectionDisplayLabel, departmentCode } from "@/lib/sections/sectionLabel";
import { deriveHodScope, buildCourseGroups, managerEffectiveYears } from "@/lib/departments/hodScope";
import type { Course, Department, SectionListItem, Subject, TeachingAssignment, FacultyMember, FacultyAssignmentRequest } from "@/types";

type AssignmentRow = TeachingAssignment & { accessLevel?: "primary" | "secondary" };
type FacultyRow = FacultyMember;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** Radix Select rejects "" as an item value, so the "no filter" option needs one. */
const ALL_DEPARTMENTS = "__all__";

export default function TeachingAssignmentsPage() {
  const user = useAuthStore((s) => s.user);
  // Two sources, kept apart and merged below rather than written into one
  // `courses` list. load()'s own-scope fetch and the scope-wide fetch further
  // down resolve independently, so a single list meant whichever landed second
  // overwrote the other: when /departments beat /courses, the scope fetch
  // merged the branches' Course docs in and load() then replaced the lot with
  // the HOD's own department's single doc. The programme was left with one
  // course id, so the shared first-year sections filed against a branch's doc
  // were never queried and the page read "No sections for this year". load()
  // running again after an assign/remove clobbered them the same way.
  const [ownCourses, setOwnCourses] = useState<Course[]>([]);
  const [scopeCourses, setScopeCourses] = useState<Course[]>([]);
  const courses = useMemo(() => {
    const byId = new Map(ownCourses.map((c) => [c.id, c]));
    for (const c of scopeCourses) byId.set(c.id, c);
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [ownCourses, scopeCourses]);
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [assignmentRequests, setAssignmentRequests] = useState<FacultyAssignmentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Shared course/year context for both the staffing-gap finder and the
  // assign-faculty form. This is a course GROUP key, not a course-doc id -
  // see buildCourseGroups for why one programme spans several docs.
  const [courseKey, setCourseKey] = useState("");
  const [year, setYear] = useState("");
  // "" = every department this HOD manages. Set once a sub-department is picked.
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [sectionsCache, setSectionsCache] = useState<Record<string, SectionListItem[]>>({});
  // Needed only to resolve department codes for section labels: a parent HOD
  // sees their own department's "A" next to each sub-department's "A", so the
  // department code is what tells them apart - see sectionDisplayLabel.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjectsCache, setSubjectsCache] = useState<Record<string, Subject[]>>({});

  const [assignForm, setAssignForm] = useState({ sectionId: "", subjectId: "", facultyId: "" });
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [requestTargetId, setRequestTargetId] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>).then((d) => setOwnCourses(d.courses ?? [])),
      fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>).then((d) => setFaculty(d.faculty ?? [])),
      fetch("/api/college/teaching-assignments?dept=true").then((r) => r.json() as Promise<{ assignments: AssignmentRow[] }>).then((d) => setAssignments(d.assignments ?? [])),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>).then((d) => setDepartments(d.departments ?? [])),
      fetch("/api/college/faculty-assignment-requests").then((r) => r.json() as Promise<{ requests: FacultyAssignmentRequest[] }>).then((d) => setAssignmentRequests(d.requests ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load teaching data" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
        await load();
    })();
  }, []);

  const scope = useMemo(() => deriveHodScope(departments, user?.department), [departments, user?.department]);
  const { deptOptions } = scope;

  // load()'s course fetch resolves to this HOD's own department only (or its
  // parent, for a sub-HOD) - it never reaches a MANAGED branch's own Course
  // doc. That's what made this page look broken: the shared first-year
  // sections are filed against the branch's Course doc (CIVIL's "Bachelor of
  // Technology"), so filtering by the common department's doc matched none of
  // them and every year read "No sections created yet". Fetch each scope
  // department's courses and merge, same as the Sections page.
  const extraCourseDeptIds = useMemo(
    () => deptOptions.filter((d) => d.id !== scope.ownDept?.id).map((d) => d.id).sort().join(","),
    [deptOptions, scope.ownDept]
  );
  useEffect(() => {
    if (!extraCourseDeptIds) return;
    let cancelled = false;
    void (async () => {
      try {
        const lists = await Promise.all(
          extraCourseDeptIds.split(",").map((id) =>
            fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`)
              .then((r) => r.json() as Promise<{ courses: Course[] }>)
              .then((j) => j.courses ?? [])
          )
        );
        if (cancelled) return;
        setScopeCourses(lists.flat());
      } catch {
        // Non-fatal - the own-scope fetch from load() still covers a plain HOD.
      }
    })();
    return () => { cancelled = true; };
  }, [extraCourseDeptIds]);

  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const course = useMemo(() => courseGroups.find((g) => g.key === courseKey) ?? null, [courseGroups, courseKey]);
  // Every course-doc id behind the chosen programme - sections and subjects
  // have to be gathered across all of them, not just one department's.
  const activeCourseIds = useMemo(() => course?.courseIds ?? [], [course]);

  // The HOD's own department plus its ACTUAL sub-departments (Department
  // .parentDepartmentId children - BS-CHEMISTRY, BS-MATHS, …).
  //
  // Deliberately not derived from the loaded sections' own `department`, which
  // is what this used to do: a shared first-year section belongs to the real
  // branch it feeds (CIVIL, ECE), so that listed the Principal's branches -
  // "secondary departments" - where sub-departments belong. Those branches are
  // reachable through whichever sub-department manages them, below.
  //
  // Empty for a sub-HOD: a sub-department has no children of its own, so the
  // filter doesn't render for them at all - they only ever work within their
  // own sub-department, and a one-option dropdown is just noise.
  const subDepartmentOptions = useMemo(() => {
    const own = scope.ownDept;
    if (!own) return [];
    const children = departments
      .filter((d) => d.parentDepartmentId === own.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    return children.length > 0 ? [own, ...children] : [];
  }, [departments, scope.ownDept]);

  // The Principal's "Years Taught", not the raw course span - offering 1..4 for
  // a department that teaches only the first year is what let this page ask for
  // a year with nothing under it.
  //
  // Scoped to this HOD's own department and its actual sub-departments, each
  // falling back to its parent's years (a sub-department is never given years
  // of its own - see college/departments POST). Deliberately NOT the branches
  // those sub-departments manage: CIVIL's own [2,3,4] belongs to CIVIL's own
  // HOD, and only the shared year its manager teaches is Basic Science's to
  // staff - which the parent fallback already contributes.
  //
  // Uses managerEffectiveYears (catalogId-aware), not the flat-only
  // managerTeachingYears - a department with a per-course override (e.g. an
  // independent M.Tech run on different years than its shared-first-year
  // B.Tech) needs THIS course's own override, not always its flat
  // assignedYears.
  const yearOptions = useMemo(() => {
    if (!course) return [];
    const relevant = subDepartmentOptions.length > 0
      ? subDepartmentOptions
      : scope.ownDept ? [scope.ownDept] : [];
    const assigned = new Set<number>();
    for (const d of relevant) for (const y of managerEffectiveYears(d, departments, course.catalogId)) assigned.add(y);
    const courseYears = Array.from({ length: course.durationYears }, (_, i) => i + 1);
    return assigned.size > 0 ? courseYears.filter((y) => assigned.has(y)) : courseYears;
  }, [course, subDepartmentOptions, scope.ownDept, departments]);

  // Keyed on the course ids, not just the group: if the scope-wide course fetch
  // lands after a year was already picked, the id set grows and this key changes
  // rather than leaving the earlier, incomplete result cached forever.
  const key = `${activeCourseIds.join("|")}_${year}`;
  // Everything this HOD may actually edit for the chosen course+year: their own
  // department's sections plus every sub-department's (a main HOD runs the whole
  // tree). Only genuinely cross-listed sections from an unrelated department
  // stay "secondary" and are excluded, since those are view-only.
  const editableSections = useMemo(
    () => (sectionsCache[key] ?? []).filter((s) => s.accessLevel !== "secondary"),
    [sectionsCache, key]
  );

  // Picking a sub-department also brings in the branches it manages: BS-ENGLISH
  // runs the shared first year for CIVIL and IT, so those sections are its
  // even though each one's own `department` names the branch.
  const filterDepartmentNames = useMemo(() => {
    if (!departmentFilter) return null;
    const d = departments.find((x) => x.name === departmentFilter);
    return new Set<string>([departmentFilter, ...(d?.managedDepartments ?? [])]);
  }, [departmentFilter, departments]);

  const sections = useMemo(
    () =>
      filterDepartmentNames
        ? editableSections.filter((s) => filterDepartmentNames.has(s.department))
        : editableSections,
    [editableSections, filterDepartmentNames]
  );
  const subjects = useMemo(() => subjectsCache[key] ?? [], [subjectsCache, key]);

  // Queried once per course-doc id and merged, since the sections/subjects
  // APIs take a single courseId and one programme spans several docs.
  async function ensureCourseYearData(courseIds: string[], k: string, y: string) {
    if (courseIds.length === 0) return;
    if (!(k in sectionsCache)) {
      const lists = await Promise.all(
        courseIds.map((cId) =>
          fetch(`/api/college/sections?courseId=${encodeURIComponent(cId)}&year=${y}`)
            .then((r) => r.json() as Promise<{ sections: SectionListItem[] }>)
            .then((d) => d.sections ?? [])
        )
      );
      const byId = new Map(lists.flat().map((s) => [s.id, s]));
      setSectionsCache((c) => ({ ...c, [k]: Array.from(byId.values()) }));
    }
    if (!(k in subjectsCache)) {
      const lists = await Promise.all(
        courseIds.map((cId) =>
          fetch(`/api/college/subjects?courseId=${encodeURIComponent(cId)}&year=${y}`)
            .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
            .then((d) => d.subjects ?? [])
        )
      );
      const byId = new Map(lists.flat().map((s) => [s.id, s]));
      setSubjectsCache((c) => ({ ...c, [k]: Array.from(byId.values()) }));
    }
  }

  function handleCourseChange(v: string) {
    setCourseKey(v);
    setYear("");
    setDepartmentFilter("");
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  function handleYearChange(v: string) {
    setYear(v);
    setDepartmentFilter("");
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  // Driven by the key rather than by the Year click, so a course list that
  // grows after a year was already picked refetches instead of leaving the
  // panels empty. The ref stops it re-firing for a key already in flight;
  // ensureCourseYearData's own cache checks handle the settled ones.
  const fetchedKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeCourseIds.length === 0 || !year) return;
    if (fetchedKeys.current.has(key)) return;
    fetchedKeys.current.add(key);
    void (async () => { await ensureCourseYearData(activeCourseIds, key, year); })();
    // ensureCourseYearData is redefined every render but reads only its
    // arguments and the caches it guards on, so it is deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, year, activeCourseIds]);

  function handleDepartmentChange(v: string) {
    // ALL is a sentinel: Radix Select can't hold "" as an item value.
    setDepartmentFilter(v === ALL_DEPARTMENTS ? "" : v);
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  // sectionId_subjectId pairs with a PENDING lend-request already out (see
  // "Or ask another department to lend a faculty member" below) - the target
  // department hasn't allocated anyone yet, but this HOD already committed to
  // waiting on them, so staffing it directly in the meantime would risk ending
  // up double-staffed the moment that department allocates their own faculty
  // (the request API only guards against a second *request* for the same
  // subject+section, not a direct assignment racing an outstanding one - see
  // college/faculty-assignment-requests/route.ts POST).
  const pendingRequestKeys = useMemo(
    () => new Set(
      assignmentRequests.filter((r) => r.status === "PENDING").map((r) => `${r.sectionId}_${r.subjectId}`)
    ),
    [assignmentRequests]
  );

  // Which subject/section combos for the selected course+year have no faculty assigned yet.
  const gapRows = useMemo(() => {
    if (!courseKey || !year) return [];
    // Matched against every course-doc id in the group: an assignment stores
    // whichever department's doc its section belongs to.
    const courseIdSet = new Set(activeCourseIds);
    return subjects.map((subject) => {
      const staffedSectionIds = new Set(
        assignments
          .filter((a) => a.subjectId === subject.id && courseIdSet.has(a.courseId ?? "") && a.year === Number(year))
          .map((a) => a.sectionId)
      );
      const unstaffedSections = sections
        .filter((s) => !staffedSectionIds.has(s.id))
        .map((s) => ({ section: s, isRequested: pendingRequestKeys.has(`${s.id}_${subject.id}`) }));
      return { subject, unstaffedSections };
    });
  }, [subjects, sections, assignments, courseKey, activeCourseIds, year, pendingRequestKeys]);

  // Subjects already staffed for the section picked in the assign-faculty form shouldn't be
  // offered again there - pick a different subject or remove the existing assignment first.
  // Same for one with a pending lend-request out - see pendingRequestKeys above.
  const availableSubjectsForAssign = assignForm.sectionId
    ? subjects.filter((s) =>
        !assignments.some((a) => a.sectionId === assignForm.sectionId && a.subjectId === s.id) &&
        !pendingRequestKeys.has(`${assignForm.sectionId}_${s.id}`)
      )
    : subjects;

  // Faculty offered here are always this HOD's own/managed department's -
  // never another department's, even for a shared 1st-year subject filed
  // under a feeder like Basic Science (see college/faculty/route.ts).
  // Staffing that instead goes through "Or ask another department to lend a
  // faculty member" below, same as for any other subject with nobody free.
  const availableFacultyForAssign = faculty;

  // Every top-level department in the college is askable, including ones this
  // HOD can already assign from directly (e.g. a managed branch whose own
  // faculty are all busy elsewhere) - only the section's own department is
  // excluded, since requesting from yourself is a no-op. Sub-departments stay
  // excluded: they don't run their own separate faculty pool to lend from.
  const requestSection = sections.find((s) => s.id === assignForm.sectionId);
  const requestableDepartments = useMemo(
    () => departments.filter((d) => !d.parentDepartmentId && d.name !== requestSection?.department),
    [departments, requestSection]
  );

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!courseKey || !year || !assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId) return;
    setSavingAssignment(true);
    try {
      const fac = faculty.find((f) => f.id === assignForm.facultyId);
      const subj = subjects.find((s) => s.id === assignForm.subjectId);
      // The section's OWN course doc, not the group - a shared first-year
      // section belongs to the branch's course, and storing the common
      // department's id here would file the assignment against the wrong one.
      const sectionCourseId = sections.find((s) => s.id === assignForm.sectionId)?.courseId ?? activeCourseIds[0];
      const res = await fetch("/api/college/teaching-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId: assignForm.facultyId,
          facultyName: fac?.name ?? "",
          courseId: sectionCourseId,
          sectionId: assignForm.sectionId,
          subjectId: assignForm.subjectId,
          hoursPerWeek: subj?.hoursPerWeek,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Faculty assigned" });
      setAssignForm({ sectionId: assignForm.sectionId, subjectId: "", facultyId: "" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleSendRequest() {
    if (!courseKey || !assignForm.sectionId || !assignForm.subjectId || !requestTargetId) return;
    setSendingRequest(true);
    try {
      const res = await fetch("/api/college/faculty-assignment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Same reasoning as handleAssign: the section's own course doc.
          courseId: sections.find((s) => s.id === assignForm.sectionId)?.courseId ?? activeCourseIds[0],
          sectionId: assignForm.sectionId,
          subjectId: assignForm.subjectId,
          targetDepartmentId: requestTargetId,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to send request", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Request sent - track it under Assignment Requests" });
      setRequestTargetId("");
      // The subject just requested drops out of availableSubjectsForAssign
      // (see pendingRequestKeys) the moment assignmentRequests refreshes -
      // clear it here too so the form doesn't sit on a now-invalid selection.
      setAssignForm((f) => ({ ...f, subjectId: "" }));
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSendingRequest(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/college/teaching-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Assignment removed" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove assignment" });
    }
  }

  // Group current assignments by course → year → section for display. Any assignment
  // missing that context (shouldn't happen going forward, but data can be old) falls into
  // its own bucket rather than silently disappearing.
  const { groups, ungrouped } = useMemo(() => {
    // `key` carries the sectionId-based map key through to React. Course name +
    // year + section NAME is not unique - a department and its sub-departments
    // each have their own "A" in the same course-year, which collides.
    const map = new Map<string, {
      key: string; courseName: string; year: number; sectionName: string;
      department?: string; items: AssignmentRow[];
    }>();
    const ungrouped: AssignmentRow[] = [];
    for (const a of assignments) {
      if (!a.courseId || a.year == null || !a.sectionId) { ungrouped.push(a); continue; }
      const k = `${a.courseId}_${a.year}_${a.sectionId}`;
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          courseName: a.courseName ?? "Course",
          year: a.year,
          sectionName: a.sectionName ?? "",
          department: a.department,
          items: [],
        });
      }
      map.get(k)!.items.push(a);
    }
    const groups = Array.from(map.values()).sort(
      (x, y) => x.courseName.localeCompare(y.courseName) || x.year - y.year || x.sectionName.localeCompare(y.sectionName)
    );
    return { groups, ungrouped };
  }, [assignments]);

  return (
    <div className="space-y-6">
      <PageHeader title="Teaching Assignments" description="Find staffing gaps and assign faculty to subjects, course &amp; year wise" />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Course, Year &amp; Department</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:max-w-3xl">
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={courseKey} onValueChange={handleCourseChange}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {/* Grouped, so one programme is a single choice rather than
                      one identical-looking entry per department that owns a
                      copy of it. */}
                  {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Year</Label>
              <Select value={year} onValueChange={(v) => void handleYearChange(v)} disabled={!course}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Only for an HOD who actually has sub-departments. A sub-HOD has
                none beneath them and works solely within their own, so the
                field is omitted rather than shown with a single option. */}
            {subDepartmentOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Sub-department</Label>
                <Select
                  value={departmentFilter || ALL_DEPARTMENTS}
                  onValueChange={handleDepartmentChange}
                  disabled={!year}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={year ? "All sub-departments" : "Select a year first"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_DEPARTMENTS}>All sub-departments</SelectItem>
                    {subDepartmentOptions.map((d) => (
                      <SelectItem key={d.id} value={d.name}>
                        {departmentCode(d.name, departments)} · {d.name}
                        {d.id === scope.ownDept?.id ? " (your department)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Unstaffed Subjects</CardTitle></CardHeader>
          <CardContent>
            {!courseKey || !year ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select a course and year above to see staffing gaps.</p>
            ) : subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No subjects defined yet for {course?.name} · {ordinalYear(Number(year))}.</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sections created yet for {course?.name} · {ordinalYear(Number(year))}.</p>
            ) : (
              <div className="space-y-3">
                {gapRows.map(({ subject, unstaffedSections }) => (
                  <div key={subject.id} className="rounded-md border p-2.5">
                    <p className="text-sm font-medium">{subject.name} <span className="text-muted-foreground">({subject.code})</span></p>
                    {unstaffedSections.length === 0 ? (
                      <Badge variant="approved" className="mt-1.5">Fully staffed</Badge>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {unstaffedSections.map(({ section: s, isRequested }) => (
                          <Badge key={s.id} variant={isRequested ? "modified" : "rejected"}>
                            {sectionDisplayLabel(s, departments)} {isRequested ? "requested" : "unstaffed"}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Assign Faculty</CardTitle></CardHeader>
          <CardContent>
            {!courseKey || !year ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select a course and year above to assign faculty.</p>
            ) : (
              <form onSubmit={handleAssign} className="space-y-3">
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select
                    value={assignForm.sectionId}
                    onValueChange={(v) => { setAssignForm({ sectionId: v, subjectId: "", facultyId: "" }); setRequestTargetId(""); }}
                  >
                    <SelectTrigger><SelectValue placeholder={sections.length ? "Select section" : "No sections for this year"} /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select
                    value={assignForm.subjectId}
                    onValueChange={(v) => { setAssignForm((f) => ({ ...f, subjectId: v })); setRequestTargetId(""); }}
                    disabled={!assignForm.sectionId}
                  >
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {availableSubjectsForAssign.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All subjects already staffed for this section</div>
                      )}
                      {availableSubjectsForAssign.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.code}{s.regulation ? ` · ${s.regulation}` : ""})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Faculty</Label>
                  <Select
                    value={assignForm.facultyId}
                    onValueChange={(v) => setAssignForm((f) => ({ ...f, facultyId: v }))}
                    disabled={!assignForm.subjectId}
                  >
                    <SelectTrigger><SelectValue placeholder={availableFacultyForAssign.length ? "Select faculty" : "No faculty in your department"} /></SelectTrigger>
                    <SelectContent>
                      {availableFacultyForAssign.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  loading={savingAssignment}
                  disabled={!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId}
                >
                  Assign
                </Button>
                <p className="text-xs text-muted-foreground">
                  Periods for this subject are picked afterwards from the faculty member&rsquo;s Edit page.
                </p>

                {assignForm.sectionId && assignForm.subjectId && (
                  <div className="pt-3 mt-3 border-t space-y-2">
                    <Label>Or ask another department to lend a faculty member</Label>
                    <div className="flex flex-wrap gap-2">
                      <Select value={requestTargetId} onValueChange={setRequestTargetId}>
                        <SelectTrigger className="flex-1 min-w-48">
                          <SelectValue placeholder={requestableDepartments.length ? "Select department" : "No other departments"} />
                        </SelectTrigger>
                        <SelectContent>
                          {requestableDepartments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        loading={sendingRequest}
                        disabled={!requestTargetId}
                        onClick={() => void handleSendRequest()}
                      >
                        <Send className="h-4 w-4 mr-2" />Send Request
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      They&rsquo;ll pick one of their own faculty for it - track it under{" "}
                      <Link href="/hod/assignment-requests" className="text-primary hover:underline">Assignment Requests</Link>.
                    </p>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments yet.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {g.courseName} · {ordinalYear(g.year)} ·{" "}
                    {/* Department included: two sections can share a letter. */}
                    {g.department ? `${departmentCode(g.department, departments)} ` : ""}
                    Section {g.sectionName}
                  </p>
                  <div className="divide-y rounded-md border">
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span>
                            {a.accessLevel === "secondary" && <Badge variant="secondary" className="text-xs">View only</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">{a.facultyName} · {a.hoursPerWeek} hrs/wk</p>
                        </div>
                        {a.accessLevel !== "secondary" && (
                          <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {ungrouped.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ungrouped</p>
                  <div className="divide-y rounded-md border">
                    {ungrouped.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span>
                            {a.accessLevel === "secondary" && <Badge variant="secondary" className="text-xs">View only</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.facultyName}
                            {a.academicYear ? ` · ${a.academicYear}` : ""}
                            {a.semester ? ` · Sem ${a.semester}` : ""}
                            {a.section ? ` · Sec ${a.section}` : ""}
                            {" "}· {a.hoursPerWeek} hrs/wk
                          </p>
                        </div>
                        {a.accessLevel !== "secondary" && (
                          <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
