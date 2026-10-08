"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Trash2, Send, Plus, X, FileDown, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { downloadTeachingAssignmentsPdf, downloadTeachingAssignmentsXlsx, type TeachingAssignmentExportRow, type FacultyWorkloadExportRow, type UnstaffedGapExportRow } from "@/lib/teaching/exportTeachingAssignments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { MAX_FACULTY_PER_SUBJECT } from "@/lib/teaching/facultyCap";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { sectionDisplayLabel, departmentCode } from "@/lib/sections/sectionLabel";
import { deriveHodScope, buildCourseGroups, managerEffectiveYears } from "@/lib/departments/hodScope";
import { fedYears } from "@/lib/college/academicStructure";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { departmentPickNames, subjectCoversSection } from "@/lib/departments/subjectCoverage";
import { coreDepartmentOptions, rollupDepartmentNames } from "@/lib/departments/departmentTree";
import { assignmentsForFilter } from "@/lib/teaching/assignmentView";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { yearSemesterLabelIn, semesterInYearLabel } from "@/lib/academic/format";
import type {
  Course, CourseYearTiming, Department, SectionListItem, Subject, SubjectSemesterAssignment,
  TeachingAssignment, FacultyMember, FacultyAssignmentRequest,
} from "@/types";

type AssignmentRow = TeachingAssignment & { accessLevel?: "primary" | "secondary" };
// `name` here is the derived display name (facultyDisplayName), not a stored field.
type FacultyRow = FacultyMember & { name: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** Radix Select rejects "" as an item value, so the "no filter" option needs one. */
const ALL_DEPARTMENTS = "__all__";

export default function TeachingAssignmentsPage() {
  const myDepartments = useMyDepartments();
  // Which of this HOD's own departments the page is scoped to - choosable
  // only when they head more than one (see useMyDepartments). `pickedTopDepartment`
  // holds only an explicit user choice; `topDepartment` (derived, not stored)
  // falls back to the first owned department, so nothing needs syncing via an
  // effect when the department list itself loads/changes.
  const [pickedTopDepartment, setPickedTopDepartment] = useState("");
  const topDepartment = pickedTopDepartment && myDepartments.includes(pickedTopDepartment)
    ? pickedTopDepartment
    : myDepartments[0] ?? "";
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
  const [removeTarget, setRemoveTarget] = useState<AssignmentRow | null>(null);
  const [removing, setRemoving] = useState(false);

  // Shared course/year context for both the staffing-gap finder and the
  // assign-faculty form. This is a course GROUP key, not a course-doc id -
  // see buildCourseGroups for why one programme spans several docs.
  const [courseKey, setCourseKey] = useState("");
  const [year, setYear] = useState("");
  // What the Load button last asked for. Course/Year only choose WHAT to load;
  // the sections/subjects/timings fetches below run for the applied pair, and
  // Semester / Sub-department are filters over what that returned (their
  // options come from it). Changing Course/Year clears it.
  const [applied, setApplied] = useState<{ key: string; year: string } | null>(null);
  // "" = every department this HOD manages. Set once a sub-department is picked.
  const [departmentFilter, setDepartmentFilter] = useState("");
  // "" = every branch the picked sub-department (or, with none picked, this
  // HOD's whole scope) manages. Set once a Core department is picked.
  const [coreFilter, setCoreFilter] = useState("");
  const [sectionsCache, setSectionsCache] = useState<Record<string, SectionListItem[]>>({});
  // Needed only to resolve department codes for section labels: a parent HOD
  // sees their own department's "A" next to each sub-department's "A", so the
  // department code is what tells them apart - see sectionDisplayLabel.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjectsCache, setSubjectsCache] = useState<Record<string, Subject[]>>({});
  // Raw SubjectSemesterAssignment rows behind subjectsCache[key] (same key,
  // last semester fetched wins - mirrors subjectsCache itself). Kept
  // separately, rather than collapsed into a subjectId-only Set as before,
  // because each row's own departmentId/departmentName is what tells two
  // sub-departments' identically-keyed (same course+year+semester) subject
  // lists apart - see gapRows/availableSubjectsForAssign below, which mirror
  // TeachingAssignmentsEditor.tsx's per-section department narrowing.
  const [semesterAssignmentsCache, setSemesterAssignmentsCache] = useState<Record<string, SubjectSemesterAssignment[]>>({});
  // Mirrors semesterFilteredKeys (the ref below that dedupes the actual
  // fetch) as render-visible state - a ref mutation alone doesn't trigger a
  // re-render, so without this the "Unstaffed Subjects"/"Assign Faculty"
  // panels would have no way to know a filter just landed and stop trusting
  // the interim raw (unfiltered) subjectsCache[key] they'd been rendering
  // while it was in flight. See subjectsSemesterReady below.
  const [semesterFilterReadyKeys, setSemesterFilterReadyKeys] = useState<Set<string>>(new Set());
  // This course+year's configured semester numbers (union across every
  // course-doc id in the group - see CourseYearTiming.semesters) - empty
  // when none are configured, which keeps the semester picker below hidden
  // and every filter that reads `effectiveSemester` a no-op, exactly as this
  // page behaved before semesters existed.
  const [timingsCache, setTimingsCache] = useState<Record<string, CourseYearTiming[]>>({});
  // An explicit user pick; falls back to the smallest configured semester
  // once options exist, rather than needing an effect to "correct" it after
  // the fact - see effectiveSemester below.
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);

  const [assignForm, setAssignForm] = useState({ sectionId: "", subjectId: "", facultyId: "" });
  // More faculty for the same subject + section, added with "+ Add another faculty" (the first is assignForm.facultyId).
  const [extraFacultyIds, setExtraFacultyIds] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  // The departments ticked in "ask other departments" - a subject can be asked of several at once.
  const [requestTargetIds, setRequestTargetIds] = useState<string[]>([]);
  const [sendingRequest, setSendingRequest] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      // includeParent: a sub-department (e.g. "DS" under "Artificial
      // Intelligence") should also offer its main/parent department's own
      // faculty when staffing a subject - see api/college/faculty's own
      // doc-comment on this param.
      fetch("/api/college/faculty?availableOnly=true&includeParent=true").then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>).then((d) => setFaculty((d.faculty ?? []).map((f) => ({ ...f, name: facultyDisplayName(f) })))),
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

  const scope = useMemo(() => deriveHodScope(departments, topDepartment), [departments, topDepartment]);
  const { deptOptions } = scope;
  const topDepartmentId = scope.ownDept?.id ?? "";

  // Own-scope course fetch, reactive to which top-level department is
  // selected - an HOD with more than one must not have its default (every
  // owned department unioned - see api/college/courses) leak into a single
  // department's Course dropdown. A single-department HOD's own id is the
  // same either way, so this mirrors the previous unscoped fetch exactly.
  useEffect(() => {
    if (myDepartments.length > 1 && !topDepartmentId) return;
    const qs = myDepartments.length > 1 ? `?departmentId=${encodeURIComponent(topDepartmentId)}` : "";
    fetch(`/api/college/courses${qs}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setOwnCourses(d.courses ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, [myDepartments, topDepartmentId]);

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
    // A year some OTHER department already claims as a feeder FOR one of
    // `relevant` (e.g. Basic Science owning year 1 of a shared-first-year
    // B.Tech) is never this HOD's own to staff - see fedYears. Nothing
    // assigned means no years (never "every year": lib/college/taughtYears.ts).
    const excluded = new Set<number>();
    for (const d of relevant) {
      for (const y of managerEffectiveYears(d, departments, course.catalogId)) assigned.add(y);
      for (const y of fedYears(d, departments, course.catalogId)) excluded.add(y);
    }
    const courseYears = Array.from({ length: course.durationYears }, (_, i) => i + 1);
    return courseYears.filter((y) => assigned.has(y) && !excluded.has(y));
  }, [course, subDepartmentOptions, scope.ownDept, departments]);

  // Keyed on the course ids, not just the group: if the scope-wide course fetch
  // lands after a year was already picked, the id set grows and this key changes
  // rather than leaving the earlier, incomplete result cached forever.
  const key = `${activeCourseIds.join("|")}_${year}`;
  const semesterAssignments = useMemo(() => semesterAssignmentsCache[key] ?? [], [semesterAssignmentsCache, key]);
  // The fetched subject list, plus any subject that is assigned for this semester
  // but missing from it (no courseId, so the course/catalog fetch never returns
  // it - e.g. CSBS's own subjects), rebuilt from the assignment's own snapshot.
  // Derived here rather than written into the cache because two loaders write
  // that cache and whichever lands last used to win, dropping these.
  const subjects = useMemo(() => {
    const base = subjectsCache[key] ?? [];
    const have = new Set(base.map((s) => s.id));
    const extra: Subject[] = [];
    for (const a of semesterAssignments) {
      if (have.has(a.subjectId)) continue;
      have.add(a.subjectId);
      extra.push({
        id: a.subjectId,
        collegeId: a.collegeId ?? "",
        courseId: a.courseId,
        name: a.subjectName,
        code: a.subjectCode,
        ...(a.shortCode ? { shortCode: a.shortCode } : {}),
        ...(a.regulation ? { regulation: a.regulation } : {}),
        hoursPerWeek: a.hoursPerWeek ?? 0,
        credits: a.credits ?? 0,
        type: a.type ?? "THEORY",
        isActive: true,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      } as Subject);
    }
    // Sorted by name so a rebuilt subject sits beside its same-named siblings
    // instead of landing at the very bottom of every list built from this.
    return extra.length > 0 ? [...base, ...extra].sort((x, y) => x.name.localeCompare(y.name)) : base;
  }, [subjectsCache, semesterAssignments, key]);
  const timings = useMemo(() => timingsCache[key] ?? [], [timingsCache, key]);
  // Union across every course-doc id in the group, sorted - a shared
  // programme's docs are all expected to agree on this, but union rather
  // than "first doc wins" costs nothing and can't leave a real semester
  // hidden if they ever briefly disagree mid-edit.
  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
  // The semester every filter/action below actually uses - the explicit pick
  // when it's still one of the current options, otherwise the smallest
  // configured one, otherwise null (no semester concept for this course-year
  // - every filter that reads this treats null as "everything matches", so
  // the page behaves exactly as it did before semesters existed).
const effectiveSemester = semesterOptions.length === 0
     ? null
     : selectedSemester != null && semesterOptions.includes(selectedSemester)
       ? selectedSemester
       : semesterOptions[0];

  // Whether `subjects` above can be trusted as this course-year's FINAL
  // list rather than the interim unfiltered one ensureCourseYearData seeds
  // it with before semesters are even known (see the semesterFilteredKeys
  // effect's own doc-comment). Two cases settle it: this course-year turned
  // out to have no semester concept at all (timings loaded, semesterOptions
  // empty - subjects was never going to be narrowed further), or the
  // semester-scoped filter for the currently effective semester has
  // actually landed. Until one of those is true, `subjects` can silently
  // swap out from under a card that already rendered it (every subject for
  // the year, unfiltered) for the narrower per-department/semester list -
  // which reads as subjects "disappearing" a few seconds after first
  // paint. Rendering a loading state instead in that window (see the
  // "Unstaffed Subjects" card below) avoids showing data that's about to change.
  const timingsReady = key in timingsCache;
  const subjectsSemesterReady = timingsReady && (
    semesterOptions.length === 0 || semesterFilterReadyKeys.has(`${key}_sem${effectiveSemester}`)
  );

  const fetchKey = `${key}_sem${effectiveSemester ?? ""}`;
  // Timings for the picked course-year have been looked up - Semester is only
  // known (or known to be absent) once they are, so Load waits for them.
  const timingsLoaded = key in timingsCache;

  // ensureCourseYearData files sections under the semester-suffixed key when a
  // semester is in play (the sections API narrows by it), so read the same one.
  const sectionsCacheKey = effectiveSemester != null ? fetchKey : key;

  // Everything this HOD may actually edit for the chosen course+year: their own
  // department's sections plus every sub-department's (a main HOD runs the whole
  // tree). Only genuinely cross-listed sections from an unrelated department
  // stay "secondary" and are excluded, since those are view-only.
  const editableSections = useMemo(
    () => (sectionsCache[sectionsCacheKey] ?? []).filter((s) => s.accessLevel !== "secondary"),
    [sectionsCache, sectionsCacheKey]
  );

  // Picking a sub-department also brings in the branches it manages: BS-ENGLISH
  // runs the shared first year for CIVIL and IT, so those sections are its
  // even though each one's own `department` names the branch. Picking the
  // parent (which holds nothing itself) stands for every sub-department and
  // every branch they manage; a managed branch that is split into sub-branches
  // (AI -> AIML / AIDS) stands for the sub-branches the sections are filed
  // under. Read from the department configuration - see departmentPickNames.
  const loadedSectionDepartments = useMemo(
    () => (sectionsCache[sectionsCacheKey] ?? []).map((s) => s.department),
    [sectionsCache, sectionsCacheKey]
  );

  // The Core departments on offer: the branches the picked sub-department - or,
  // with none picked, this whole scope - runs the shared year for, that actually
  // have sections in what was loaded. A managed branch split into sub-branches
  // is offered as those sub-branches. See coreDepartmentOptions.
  const coreOptions = useMemo(() => {
    const picked = departmentFilter
      ? [departmentFilter]
      : subDepartmentOptions.length > 0 ? subDepartmentOptions.map((d) => d.name) : scope.ownDept ? [scope.ownDept.name] : [];
    return coreDepartmentOptions(departments, picked, loadedSectionDepartments);
  }, [departmentFilter, subDepartmentOptions, scope.ownDept, departments, loadedSectionDepartments]);
  const activeCore = coreOptions.includes(coreFilter) ? coreFilter : "";

  const filterDepartmentNames = useMemo(() => {
    // A Core department stands for itself and, if it holds no sections of its
    // own, the sub-branches they are filed under.
    if (activeCore) return new Set([activeCore, ...rollupDepartmentNames(departments, activeCore)]);
    if (!departmentFilter) return null;
    return departmentPickNames(departments, departmentFilter, loadedSectionDepartments);
  }, [activeCore, departmentFilter, departments, loadedSectionDepartments]);

  const sections = useMemo(
    () =>
      filterDepartmentNames
        ? editableSections.filter((s) => filterDepartmentNames.has(s.department))
        : editableSections,
    [editableSections, filterDepartmentNames]
  );

  // ensureCourseYearData's own subjects fetch (below) is unfiltered -
  // effectiveSemester isn't known yet the first time it runs. Once a real
  // semester resolves, narrow subjectsCache[key] down to only subjects
  // mapped (per department - see SubjectSemesterAssignment, types/teaching.ts)
  // to it (see academics/assign-semester/page.tsx). Queried per course-doc id
  // (activeCourseIds), same "union across the group" convention this page
  // already uses for sections/timings - a shared programme's course-doc ids
  // can each belong to a different department. No semesters configured
  // (effectiveSemester === null) leaves the full unfiltered list in place,
  // exactly as before.
  const semesterFilteredKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Deliberately no `course?.catalogId` requirement - the fetches below key
    // only on courseId/year/semester, never catalogId, so gating on it just
    // skipped filtering forever for any course lacking one (a legacy,
    // pre-catalog-migration course/group), leaving the raw "every subject for
    // this year" list in subjectsCache[key] in place with no way to recover.
    if (!applied || effectiveSemester == null || activeCourseIds.length === 0 || !year) return;
    const filterKey = `${key}_sem${effectiveSemester}`;
    if (semesterFilteredKeys.current.has(filterKey)) return;
    semesterFilteredKeys.current.add(filterKey);
    void (async () => {
      try {
      // Subjects fetched by catalogId when available, not per-courseId union -
      // a master subject is department-independent (see /api/college/subjects
      // GET's own doc-comment), physically filed under whichever ONE
      // department's Course doc happened to create it, which can be outside
      // this HOD's own activeCourseIds (departments/courses they manage)
      // entirely. Without this, a subject legitimately assigned to this
      // department's semester (assignedIds, correctly scoped) could still be
      // silently dropped by the join below if its own courseId falls outside
      // activeCourseIds. Falls back to the courseId union only when this
      // course has no catalogId (a legacy, pre-catalog-migration course).
      // A branch fed by a shared first year (e.g. CSBS under BS-Chemistry) files
      // its semester subjects under ITS OWN Course doc, which can sit outside
      // activeCourseIds; and some were imported with the catalog id itself as
      // the courseId. Query every same-catalog course doc plus the catalog id,
      // or that branch's subjects never load.
      // The sections API also returns a managed branch's own sections whatever
      // course was asked for (CSBS-A comes back with its own courseId), so their
      // course ids are the surest way to reach that branch's subjects.
      const sectionCourseIds = (await Promise.all(
        activeCourseIds.map((cId) =>
          fetch(`/api/college/sections?courseId=${encodeURIComponent(cId)}&year=${encodeURIComponent(year)}&semester=${effectiveSemester}`)
            .then((r) => r.json() as Promise<{ sections?: { courseId?: string }[] }>)
            .then((d) => (d.sections ?? []).map((s) => s.courseId).filter((x): x is string => !!x))
            .catch(() => [] as string[])
        )
      )).flat();
      const assignmentCourseIds = Array.from(new Set([
        ...activeCourseIds,
        ...sectionCourseIds,
        ...(course?.catalogId
          ? [course.catalogId, ...courses.filter((c) => c.catalogId === course.catalogId).map((c) => c.id)]
          : []),
      ]));
      const [assignLists, subjectsLists] = await Promise.all([
        Promise.all(
          assignmentCourseIds.map((courseId) =>
            fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}&semester=${effectiveSemester}`)
              .then((r) => r.json() as Promise<{ assignments?: SubjectSemesterAssignment[] }>)
              .then((d) => d.assignments ?? [])
          )
        ),
        course?.catalogId
          ? fetch(`/api/college/subjects?catalogId=${encodeURIComponent(course.catalogId)}`)
              .then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
              .then((d) => [d.subjects ?? []])
          : Promise.all(
              activeCourseIds.map((courseId) =>
                fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}`)
                  .then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
                  .then((d) => d.subjects ?? [])
              )
            ),
      ]);
      const flatAssignments = assignLists.flat();
      const assignedIds = new Set(flatAssignments.map((a) => a.subjectId));
      const allSubjects = subjectsLists.flat();
      const byId = new Map(allSubjects.map((s) => [s.id, s]));
      const filtered = Array.from(byId.values()).filter((s) => assignedIds.has(s.id));
      // A subject with no courseId (e.g. the shared "SUB_GEN_*" ones filed per
      // section) is never returned by the course/catalog fetch above, yet is
      // genuinely assigned to this semester - rebuild it from the assignment's
      // own snapshot, same fallback TeachingAssignmentsEditor uses, or its
      // department would show no subjects at all.
      for (const a of flatAssignments) {
        if (byId.has(a.subjectId) || filtered.some((s) => s.id === a.subjectId)) continue;
        filtered.push({
          id: a.subjectId,
          collegeId: a.collegeId ?? "",
          courseId: a.courseId,
          name: a.subjectName,
          code: a.subjectCode,
          ...(a.shortCode ? { shortCode: a.shortCode } : {}),
          ...(a.regulation ? { regulation: a.regulation } : {}),
          hoursPerWeek: a.hoursPerWeek ?? 0,
          credits: a.credits ?? 0,
          type: a.type ?? "THEORY",
          isActive: true,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        } as Subject);
      }
      setSubjectsCache((c) => ({ ...c, [key]: filtered }));
      setSemesterAssignmentsCache((c) => ({ ...c, [key]: flatAssignments }));
      setSemesterFilterReadyKeys((prev) => {
        const next = new Set(prev);
        next.add(filterKey);
        return next;
      });
      } catch {
        // Let Reload try again instead of leaving "Unstaffed Subjects" loading forever.
        semesterFilteredKeys.current.delete(filterKey);
        toast({ variant: "destructive", title: "Failed to load subjects for this semester" });
      }
    })();
  }, [applied, key, year, activeCourseIds, effectiveSemester, course, courses]);

  // Queried once per course-doc id and merged, since the sections/timings
  // APIs take a single courseId and one programme spans several docs.
  // Subjects are the one exception - fetched by catalogId when given (see
  // the semesterFilteredKeys effect above for why courseId union alone
  // misses subjects filed under a department outside courseIds).
  async function ensureCourseYearData(courseIds: string[], k: string, y: string, sem?: number | null, catalogId?: string) {
    if (courseIds.length === 0) return;
    const cacheKey = sem != null ? `${k}_sem${sem}` : k;
    const semQs = sem != null ? `&semester=${sem}` : "";
    if (!(cacheKey in sectionsCache)) {
      const lists = await Promise.all(
        courseIds.map((cId) =>
          fetch(`/api/college/sections?courseId=${encodeURIComponent(cId)}&year=${y}${semQs}`)
            .then((r) => r.json() as Promise<{ sections: SectionListItem[] }>)
            .then((d) => d.sections ?? [])
        )
      );
      const byId = new Map(lists.flat().map((s) => [s.id, s]));
      setSectionsCache((c) => ({ ...c, [cacheKey]: Array.from(byId.values()) }));
    }
    if (!(k in subjectsCache)) {
      const lists = catalogId
        ? [await fetch(`/api/college/subjects?catalogId=${encodeURIComponent(catalogId)}`)
            .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
            .then((d) => d.subjects ?? [])]
        : await Promise.all(
            courseIds.map((cId) =>
              fetch(`/api/college/subjects?courseId=${encodeURIComponent(cId)}&year=${y}`)
                .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
                .then((d) => d.subjects ?? [])
            )
          );
      const byId = new Map(lists.flat().map((s) => [s.id, s]));
      setSubjectsCache((c) => ({ ...c, [k]: Array.from(byId.values()) }));
    }
    if (!(k in timingsCache)) {
      const lists = await Promise.all(
        courseIds.map((cId) =>
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(cId)}`)
            .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
            .then((d) => (d.timings ?? []).filter((t) => t.year === Number(y)))
        )
      );
      setTimingsCache((c) => ({ ...c, [k]: lists.flat() }));
    }
  }

  function handleTopDepartmentChange(v: string) {
    setPickedTopDepartment(v);
    // A different top-level department has a different course list, sub-
    // department cascade, and assigned years - clear everything downstream.
    setApplied(null);
    setCourseKey(""); setYear(""); setDepartmentFilter(""); setCoreFilter(""); setSelectedSemester(null);
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  function handleCourseChange(v: string) {
    setApplied(null);
    setCourseKey(v);
    setYear("");
    setDepartmentFilter(""); setCoreFilter("");
    setSelectedSemester(null);
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  function handleYearChange(v: string) {
    setApplied(null);
    setYear(v);
    setDepartmentFilter(""); setCoreFilter("");
    setSelectedSemester(null);
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  // Driven by the key rather than by the Year click, so a course list that
  // grows after a year was already picked refetches instead of leaving the
  // panels empty. The ref stops it re-firing for a key already in flight;
  // ensureCourseYearData's own cache checks handle the settled ones.
  // Option lookup for the Semester filter: this course-year's timings. Runs when
  // Course and Year are picked (it only fills a dropdown); sections, subjects
  // and everything else wait for Load.
  const timingsRequested = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeCourseIds.length === 0 || !year || key in timingsCache) return;
    if (timingsRequested.current.has(key)) return;
    timingsRequested.current.add(key);
    const ids = activeCourseIds;
    const y = year;
    const k = key;
    void (async () => {
      try {
        const lists = await Promise.all(
          ids.map((cId) =>
            fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(cId)}`)
              .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
              .then((d) => (d.timings ?? []).filter((t) => t.year === Number(y)))
          )
        );
        setTimingsCache((c) => ({ ...c, [k]: lists.flat() }));
      } catch {
        timingsRequested.current.delete(k);
        toast({ variant: "destructive", title: "Failed to load semesters" });
      }
    })();
  }, [activeCourseIds, year, key, timingsCache]);

  const fetchedKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!applied || activeCourseIds.length === 0 || !year) return;
    if (fetchedKeys.current.has(fetchKey)) return;
    fetchedKeys.current.add(fetchKey);
    void (async () => {
      try {
        await ensureCourseYearData(activeCourseIds, key, year, effectiveSemester, course?.catalogId);
      } catch {
        fetchedKeys.current.delete(fetchKey);
        toast({ variant: "destructive", title: "Failed to load sections and subjects" });
      }
    })();
    // ensureCourseYearData is redefined every render but reads only its
    // arguments and the caches it guards on, so it is deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, key, year, effectiveSemester, activeCourseIds, course]);

  function handleDepartmentChange(v: string) {
    // ALL is a sentinel: Radix Select can't hold "" as an item value.
    setApplied(null);
    setDepartmentFilter(v === ALL_DEPARTMENTS ? "" : v);
    setCoreFilter("");
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

  // Which department(s) a subject was actually mapped to for this semester
  // (see academics/subjects's "Assign to Semester" tab) - a subject with NO
  // rows here at all (no semester concept configured for this course-year,
  // so semesterAssignments is empty) is left unrestricted, matching this
  // page's behavior from before per-department semester mapping existed.
  // Mirrors TeachingAssignmentsEditor.tsx's own validDeptIds/validDeptNames
  // narrowing, which is what this page was missing - without it, a subject
  // mapped to ONE sub-department (e.g. BS-Chemistry) showed up in every
  // OTHER sub-department's dropdown too, as long as they shared the same
  // course+year+semester (the shared-first-year case in academicStructure.ts).
  function subjectDepartmentSets(subjectId: string) {
    const deptIds = new Set<string>();
    const deptNames = new Set<string>();
    for (const a of semesterAssignments) {
      if (a.subjectId !== subjectId) continue;
      if (a.departmentId) deptIds.add(a.departmentId);
      const n = a.departmentName ?? a.department;
      if (n) deptNames.add(n);
    }
    return { deptIds, deptNames };
  }
  // No fallback to "show it anyway" when a subject has no rows for THIS
  // department - that's precisely a subject nobody has assigned to this
  // department's semester yet, and offering it would let faculty get staffed
  // onto a subject the HOD never confirmed applies to their own students.
  // The one legitimate "unrestricted" case is a course-year with no semester
  // concept configured at all (effectiveSemester == null) - subjects never
  // went through per-department semester mapping there, so nothing here can
  // narrow them and the page behaves exactly as it did before that mapping
  // existed.
  function sectionMatchesSubjectDepartment(section: SectionListItem, subjectId: string) {
    if (effectiveSemester == null) return true;
    const { deptIds, deptNames } = subjectDepartmentSets(subjectId);
    // The exact department match, plus - for a shared-first-year department
    // (e.g. BS-English) that owns no sections of its own - the branches it feeds
    // (CIVIL, IT, ...), named on that department's own managedDepartments and
    // carried as each fed section's plain `department` string, including the
    // sub-branches of a managed branch that is itself split up (AI -> AIML /
    // AIDS). Without this, a subject assigned to a feeder department with no
    // sections of its own matched zero sections, so gapRows dropped it from
    // Unstaffed Subjects entirely instead of surfacing the fed branches' real
    // gaps. See subjectCoversSection (lib/departments/subjectCoverage.ts).
    return subjectCoversSection(departments, { ids: deptIds, names: deptNames }, section.department);
  }

  // Which subject/section combos for the selected course+year (and, once
  // this course-year has semesters configured, the selected semester) have
  // no faculty assigned yet. `subjects` itself is already narrowed to the
  // selected semester by the effect above (once one resolves) via each
  // subject's own `semester` mapping (see academics/subjects's "Assign to
  // Semester" tab) - switching semesters swaps in that semester's own subject
  // list, so a gap here is always for a subject actually offered this
  // semester, not a stale cross-semester one. Sections are further narrowed
  // to only the subject's own assigned department(s) - see
  // sectionMatchesSubjectDepartment above.
  const gapRows = useMemo(() => {
    if (!courseKey || !year) return [];
    // Matched against every course-doc id in the group: an assignment stores
    // whichever department's doc its section belongs to.
    const courseIdSet = new Set(activeCourseIds);
    return subjects
      .map((subject) => {
        const matchedSections = sections.filter((s) => sectionMatchesSubjectDepartment(s, subject.id));
        const staffedSectionIds = new Set(
          assignments
            .filter((a) =>
              a.subjectId === subject.id && courseIdSet.has(a.courseId ?? "") && a.year === Number(year) &&
              matchesCurrentSemester(a.timetableSemester, effectiveSemester)
            )
            .map((a) => a.sectionId)
        );
        // Every matched section still counts toward staffing, including one
        // with studentCount 0 (a section created ahead of enrollment) - an
        // empty section isn't exempt from needing a faculty assigned, so it
        // stays in this list rather than being filtered out by student count.
        const unstaffedSections = matchedSections
          .filter((s) => !staffedSectionIds.has(s.id))
          .map((s) => ({ section: s, isRequested: pendingRequestKeys.has(`${s.id}_${subject.id}`) }));
        return { subject, matchedSections, unstaffedSections };
      })
      // A subject with zero matched sections (this department has no
      // section for it at all - e.g. just imported, no Sections created
      // yet) has nothing to be "fully staffed" against - dropped from the
      // list entirely rather than falling through to the same
      // unstaffedSections.length === 0 check a genuinely fully-staffed
      // subject hits, which previously mislabeled it "Fully staffed".
      .filter(({ matchedSections }) => matchedSections.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, sections, assignments, courseKey, activeCourseIds, year, pendingRequestKeys, effectiveSemester, semesterAssignments, departments]);

  // Subjects already staffed for the section picked in the assign-faculty form shouldn't be
  // offered again there - pick a different subject or remove the existing assignment first.
  // Same for one with a pending lend-request out - see pendingRequestKeys above. Also narrowed
  // to the picked section's own curriculum regulation, if it has one set, AND to the picked
  // section's own department (see sectionMatchesSubjectDepartment above) - lenient both ways,
  // same as TeachingAssignmentsEditor's own filter and api/college/subjects GET.
  const availableSubjectsForAssign = assignForm.sectionId
    ? (() => {
        const selectedSection = sections.find((s) => s.id === assignForm.sectionId);
        if (!selectedSection) return subjects;
        const deptFilteredSubjects = subjects.filter((s) => sectionMatchesSubjectDepartment(selectedSection, s.id));
        const hasRegulationMatches = deptFilteredSubjects.some(
          (s) => !selectedSection.regulation || !s.regulation || s.regulation === selectedSection.regulation
        );
        return deptFilteredSubjects.filter((s) => {
          if (hasRegulationMatches && selectedSection.regulation && s.regulation && s.regulation !== selectedSection.regulation) {
            return false;
          }
          // A subject stays pickable whether or not it already has faculty or open requests -
          // more faculty can be assigned, or other departments asked.
          return true;
        });
      })()
    : subjects;

  // Why the Subject list is empty for the picked section - an empty list is almost
  // never "already staffed" (staffed subjects stay pickable): it is the section's
  // department having no subject assigned to this semester.
  const pickedSection = sections.find((s) => s.id === assignForm.sectionId);
  const emptySubjectsReason = !pickedSection || subjects.length === 0
    ? "No subjects offered for this semester"
    : `No subjects are assigned to ${pickedSection.department} for this semester yet - ask Academics to assign them (Assign to Semester)`;

  // Faculty offered here span this HOD's own department and true
  // sub-departments only - never a grouped/managed "core" branch, for a
  // sub-HOD or the main HOD alike (see canHodManageFacultyDepartment's own
  // doc-comment, lib/departments/scope.ts). A managed branch's faculty
  // roster is never this HOD's, so staffing one of its subjects always goes
  // through the lend flow below, same as any genuinely outside department.
  // Faculty already assigned to the picked subject in this section (and semester) are not offered again.
  const alreadyOnSubject = new Set(
    assignments
      .filter((a) => a.sectionId === assignForm.sectionId && a.subjectId === assignForm.subjectId && matchesCurrentSemester(a.timetableSemester, effectiveSemester))
      .map((a) => a.facultyId),
  );
  const availableFacultyForAssign = faculty.filter((f) => !alreadyOnSubject.has(f.id));

  // Every department and sub-department in the college is askable, none hidden -
  // including this HOD's own and the section's own department.
  const requestableDepartments = useMemo(
    () => departments,
    [departments]
  );

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!courseKey || !year || !assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId) return;
    setSavingAssignment(true);
    try {
      const subj = subjects.find((s) => s.id === assignForm.subjectId);
      // The section's OWN course doc, not the group - a shared first-year
      // section belongs to the branch's course, and storing the common
      // department's id here would file the assignment against the wrong one.
      const sectionCourseId = sections.find((s) => s.id === assignForm.sectionId)?.courseId ?? activeCourseIds[0];
      // One assignment per chosen faculty, in the order picked; a failure stops the rest
      // and says which one, so nothing is half-hidden.
      const ids = Array.from(new Set([assignForm.facultyId, ...extraFacultyIds].filter(Boolean)));
      let done = 0;
      for (const facultyId of ids) {
        const fac = faculty.find((f) => f.id === facultyId);
        const res = await fetch("/api/college/teaching-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facultyId,
            facultyName: fac?.name ?? "",
            courseId: sectionCourseId,
            sectionId: assignForm.sectionId,
            subjectId: assignForm.subjectId,
            hoursPerWeek: subj?.hoursPerWeek,
            ...(effectiveSemester != null ? { timetableSemester: effectiveSemester } : {}),
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: `Failed to assign ${fac?.name ?? "faculty"}`, description: json.error });
          break;
        }
        done++;
      }
      if (done > 0) {
        toast({ variant: "success", title: done === 1 ? "Faculty assigned" : `${done} faculty assigned` });
        setAssignForm({ sectionId: assignForm.sectionId, subjectId: "", facultyId: "" });
        setExtraFacultyIds([]);
        load();
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleSendRequest() {
    if (!courseKey || !assignForm.sectionId || !assignForm.subjectId || requestTargetIds.length === 0) return;
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
          targetDepartmentIds: requestTargetIds,
        }),
      });
      const json = await res.json() as { error?: string; created?: { departmentName: string }[]; skipped?: { departmentName: string; reason: string }[] };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to send request", description: json.error });
        return;
      }
      const sent = json.created?.length ?? 0;
      const skipped = json.skipped ?? [];
      toast({
        variant: "success",
        title: `Request sent to ${sent} department${sent === 1 ? "" : "s"} - track it under Assignment Requests`,
        description: skipped.length > 0 ? `Already pending with ${skipped.map((x) => x.departmentName).join(", ")}.` : undefined,
      });
      setRequestTargetIds([]);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSendingRequest(false);
    }
  }

  // Clears a whole section at once - its assignments AND the timetable booked
  // for them (same endpoint as "Delete entire timetable" in the Timetable tab),
  // for the semester currently selected on this page.
  const [resetTarget, setResetTarget] = useState<{ sectionId: string; label: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  // Takes back one request sent to another department, so its "requested"
  // badge goes back to "unstaffed" and the subject can be assigned directly.
  async function handleCancelRequest(sectionId: string, subjectId: string) {
    const req = assignmentRequests.find((r) => r.sectionId === sectionId && r.subjectId === subjectId && r.status === "PENDING");
    if (!req) return;
    try {
      const res = await fetch(`/api/college/faculty-assignment-requests?id=${encodeURIComponent(req.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to delete request", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Request deleted" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete request" });
    }
  }

  async function handleResetSection(sectionId: string) {
    setResetting(true);
    try {
      const semesterQuery = effectiveSemester != null ? `&semester=${effectiveSemester}` : "";
      const res = await fetch(`/api/college/timetable/reset?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as { error?: string; removedAssignments?: number };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to delete assignments", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Section cleared", description: `${json.removedAssignments ?? 0} assignment(s) and their timetable removed.` });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete assignments" });
    } finally {
      setResetting(false);
      setResetTarget(null);
    }
  }

  async function handleRemove(id: string) {
    setRemoving(true);
    try {
      const res = await fetch(`/api/college/teaching-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to remove assignment", description: json.error ?? `Server answered ${res.status}` });
        return;
      }
      toast({ variant: "success", title: "Assignment removed" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to remove assignment", description: err instanceof Error ? err.message : "Network error" });
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  // The Current Assignments list follows the same filters the Unstaffed Subjects
  // and Assign Faculty panels were loaded with - course, year, semester and
  // sub-department - so the three always agree. Before Load there is nothing to
  // follow, so everything shows as it always did, and "Show all" brings the
  // full list back at any time. Display only: nothing is removed from
  // `assignments`, and the exports / Delete all keep using the full list.
  const [showAllAssignments, setShowAllAssignments] = useState(false);
  const assignmentsInView = useMemo(() => {
    if (!applied || showAllAssignments || !course || !year) return assignments;
    return assignmentsForFilter(assignments, {
      courseIds: new Set(activeCourseIds),
      year: Number(year),
      semester: effectiveSemester,
      departmentNames: filterDepartmentNames,
    });
  }, [assignments, applied, showAllAssignments, course, year, activeCourseIds, effectiveSemester, filterDepartmentNames]);
  const hiddenAssignmentCount = assignments.length - assignmentsInView.length;

  // Group current assignments by course → year → section for display. Any assignment
  // missing that context (shouldn't happen going forward, but data can be old) falls into
  // its own bucket rather than silently disappearing.
  const { groups, ungrouped } = useMemo(() => {
    // `key` carries the sectionId-based map key through to React. Course name +
    // year + section NAME is not unique - a department and its sub-departments
    // each have their own "A" in the same course-year, which collides.
    const map = new Map<string, {
      key: string; sectionId: string; courseName: string; year: number; sectionName: string;
      department?: string; items: AssignmentRow[];
    }>();
    const ungrouped: AssignmentRow[] = [];
    for (const a of assignmentsInView) {
      if (!a.courseId || a.year == null || !a.sectionId) { ungrouped.push(a); continue; }
      const k = `${a.courseId}_${a.year}_${a.sectionId}`;
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          sectionId: a.sectionId,
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
  }, [assignmentsInView]);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  async function handleExportPdf() {
    setIsExportingPdf(true);
    try {
      const exportAssignments: TeachingAssignmentExportRow[] = assignments.map((a) => ({
        courseName: a.courseName ?? "",
        year: a.year ?? 1,
        sectionName: a.sectionName ?? "",
        subjectCode: a.subjectCode,
        subjectName: a.subjectName ?? "",
        facultyName: a.facultyName ?? "",
        hoursPerWeek: a.hoursPerWeek ?? 0,
      }));

      const wlMap = new Map<string, FacultyWorkloadExportRow>();
      for (const f of faculty) {
        wlMap.set(f.id, {
          facultyName: f.name,
          designation: f.designation,
          department: f.department,
          assignedSubjects: "",
          totalHours: 0,
        });
      }
      for (const a of assignments) {
        if (!a.facultyId) continue;
        const entry = wlMap.get(a.facultyId);
        if (entry) {
          entry.totalHours += a.hoursPerWeek ?? 0;
          const label = `${a.subjectName} (${a.sectionName ?? ""})`;
          entry.assignedSubjects = entry.assignedSubjects ? `${entry.assignedSubjects}, ${label}` : label;
        }
      }

      const gaps: UnstaffedGapExportRow[] = gapRows.flatMap((g) =>
        g.unstaffedSections.map((u) => ({
          sectionName: u.section.name,
          subjectName: g.subject.name,
          hoursPerWeek: g.subject.hoursPerWeek ?? 0,
          subjectType: g.subject.type,
        }))
      );

      await downloadTeachingAssignmentsPdf(
        {
          departmentName: topDepartment || "Department",
          courseName: course?.name,
          yearLabel: year ? ordinalYear(Number(year)) : undefined,
          semesterLabel: effectiveSemester != null ? `Sem ${effectiveSemester}` : undefined,
          assignments: exportAssignments,
          facultyWorkload: Array.from(wlMap.values()),
          unstaffedGaps: gaps,
        },
        `Teaching-Assignments-${topDepartment || "Dept"}.pdf`
      );
      toast({ title: "Report exported", description: "Saved as PDF" });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Export failed", description: "Failed to generate PDF" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function handleExportXlsx() {
    setIsExportingXlsx(true);
    try {
      const exportAssignments: TeachingAssignmentExportRow[] = assignments.map((a) => ({
        courseName: a.courseName ?? "",
        year: a.year ?? 1,
        sectionName: a.sectionName ?? "",
        subjectCode: a.subjectCode,
        subjectName: a.subjectName ?? "",
        facultyName: a.facultyName ?? "",
        hoursPerWeek: a.hoursPerWeek ?? 0,
      }));

      const wlMap = new Map<string, FacultyWorkloadExportRow>();
      for (const f of faculty) {
        wlMap.set(f.id, {
          facultyName: f.name,
          designation: f.designation,
          department: f.department,
          assignedSubjects: "",
          totalHours: 0,
        });
      }
      for (const a of assignments) {
        if (!a.facultyId) continue;
        const entry = wlMap.get(a.facultyId);
        if (entry) {
          entry.totalHours += a.hoursPerWeek ?? 0;
          const label = `${a.subjectName} (${a.sectionName ?? ""})`;
          entry.assignedSubjects = entry.assignedSubjects ? `${entry.assignedSubjects}, ${label}` : label;
        }
      }

      const gaps: UnstaffedGapExportRow[] = gapRows.flatMap((g) =>
        g.unstaffedSections.map((u) => ({
          sectionName: u.section.name,
          subjectName: g.subject.name,
          hoursPerWeek: g.subject.hoursPerWeek ?? 0,
          subjectType: g.subject.type,
        }))
      );

      await downloadTeachingAssignmentsXlsx(
        {
          departmentName: topDepartment || "Department",
          courseName: course?.name,
          yearLabel: year ? ordinalYear(Number(year)) : undefined,
          semesterLabel: effectiveSemester != null ? `Sem ${effectiveSemester}` : undefined,
          assignments: exportAssignments,
          facultyWorkload: Array.from(wlMap.values()),
          unstaffedGaps: gaps,
        },
        `Teaching-Assignments-${topDepartment || "Dept"}.xlsx`
      );
      toast({ title: "Report exported", description: "Saved as Excel spreadsheet" });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Export failed", description: "Failed to export spreadsheet" });
    } finally {
      setIsExportingXlsx(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Assignments"
        description="Find staffing gaps and assign faculty to subjects, course &amp; year wise"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={isExportingPdf}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              {isExportingPdf ? "Generating..." : "Export PDF"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportXlsx} disabled={isExportingXlsx}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
              {isExportingXlsx ? "Exporting..." : "Export Excel"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/hod/assignment-requests"><Send className="h-4 w-4 mr-2" />Assignment Requests</Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Course, Year &amp; Department</CardTitle></CardHeader>
        <CardContent>
          {/* Only for an HOD who heads more than one department. */}
          {myDepartments.length > 1 && (
            <div className="mb-4 max-w-xs space-y-2">
              <Label>Department</Label>
              <Select value={topDepartment} onValueChange={handleTopDepartmentChange}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:max-w-4xl">
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
            {/* Only once this course-year has semesters configured (see
                College Office/Principal's "Semester Timings") - otherwise
                there's nothing to pick and the page behaves exactly as
                before this feature existed. */}
            {semesterOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Semester</Label>
                <Select value={String(effectiveSemester ?? "")} onValueChange={(v) => { setApplied(null); setSelectedSemester(Number(v)); }}>
                  <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                  <SelectContent>
                    {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{semesterInYearLabel(semesterOptions, s, { format: "short" })}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            {/* The branches the picked sub-department (or this whole scope) runs
                the shared year for. Only with a choice to make. */}
            {coreOptions.length > 1 && (
              <div className="space-y-2">
                <Label>Core department</Label>
                <Select
                  value={activeCore || ALL_DEPARTMENTS}
                  onValueChange={(v) => {
                    setApplied(null);
                    setCoreFilter(v === ALL_DEPARTMENTS ? "" : v);
                    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
                  }}
                  disabled={!year}
                >
                  <SelectTrigger><SelectValue placeholder="All core departments" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_DEPARTMENTS}>All core departments</SelectItem>
                    {coreOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2 flex flex-col justify-end">
              <Button
                onClick={() => { if (courseKey && year) { setApplied({ key: courseKey, year }); setShowAllAssignments(false); } }}
                disabled={!courseKey || !year || !timingsLoaded || (semesterOptions.length > 0 && effectiveSemester == null)}
              >
                <Search className="h-4 w-4 mr-2" />{applied ? "Reload" : "Load"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Unstaffed Subjects</CardTitle></CardHeader>
          <CardContent>
            {!applied ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select the course, year, semester and sub-department, then press Load to see staffing gaps.</p>
            ) : !subjectsSemesterReady ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
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
                            {isRequested && (
                              <button
                                type="button"
                                className="ml-1.5 rounded-full px-1 leading-none hover:bg-black/10"
                                title="Delete this request"
                                aria-label={`Delete the request for ${subject.name} in ${sectionDisplayLabel(s, departments)}`}
                                onClick={() => void handleCancelRequest(s.id, subject.id)}
                              >
                                ×
                              </button>
                            )}
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
            {!applied ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select the course, year, semester and sub-department, then press Load to assign faculty.</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sections created yet for {course?.name} · {ordinalYear(Number(year))}.</p>
            ) : (
              <form onSubmit={handleAssign} className="space-y-3">
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select
                    value={assignForm.sectionId}
                    onValueChange={(v) => { setAssignForm({ sectionId: v, subjectId: "", facultyId: "" }); setExtraFacultyIds([]); setRequestTargetIds([]); }}
                  >
                    <SelectTrigger><SelectValue placeholder={sections.length ? "Select section" : "No sections for this year"} /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Works on an empty section too - the per-section "Delete all"
                      below only exists while it still has assignments, which left
                      a section's old requests with no way to clear them. */}
                  {assignForm.sectionId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        const sec = sections.find((x) => x.id === assignForm.sectionId);
                        setResetTarget({ sectionId: assignForm.sectionId, label: sec ? sectionDisplayLabel(sec, departments) : "this section" });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />Clear assignments &amp; requests for this section
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select
                    value={assignForm.subjectId}
                    onValueChange={(v) => { setAssignForm((f) => ({ ...f, subjectId: v, facultyId: "" })); setExtraFacultyIds([]); setRequestTargetIds([]); }}
                    disabled={!assignForm.sectionId}
                  >
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {availableSubjectsForAssign.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          {emptySubjectsReason}
                        </div>
                      )}
                      {availableSubjectsForAssign.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.shortCode || s.code}{s.regulation ? ` · ${s.regulation}` : ""})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Faculty</Label>
                  <Select
                    value={assignForm.facultyId}
                    onValueChange={(v) => { setAssignForm((f) => ({ ...f, facultyId: v })); setExtraFacultyIds((ids) => ids.filter((id) => id !== v)); }}
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

                  {/* More faculty for the same subject in this section - each picks from
                      whoever is not already chosen here or assigned to it. */}
                  {extraFacultyIds.map((id, i) => {
                    const chosenElsewhere = new Set([assignForm.facultyId, ...extraFacultyIds.filter((_, j) => j !== i)]);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <Select value={id} onValueChange={(v) => setExtraFacultyIds((ids) => ids.map((x, j) => (j === i ? v : x)))}>
                          <SelectTrigger><SelectValue placeholder="Select faculty" /></SelectTrigger>
                          <SelectContent>
                            {availableFacultyForAssign.filter((f) => !chosenElsewhere.has(f.id)).map((f) => (
                              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" size="icon" variant="ghost" title="Remove this faculty" onClick={() => setExtraFacultyIds((ids) => ids.filter((_, j) => j !== i))}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      !assignForm.facultyId ||
                      extraFacultyIds.some((id) => !id) ||
                      availableFacultyForAssign.length <= 1 + extraFacultyIds.length ||
                      1 + extraFacultyIds.length + alreadyOnSubject.size >= MAX_FACULTY_PER_SUBJECT
                    }
                    onClick={() => setExtraFacultyIds((ids) => [...ids, ""])}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />Add another faculty
                  </Button>
                </div>
                <Button
                  type="submit"
                  loading={savingAssignment}
                  disabled={!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId || extraFacultyIds.some((id) => !id)}
                >
                  {extraFacultyIds.length > 0 ? `Assign ${1 + extraFacultyIds.length} faculty` : "Assign"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Periods for this subject are picked afterwards from the faculty member&rsquo;s Edit page.
                </p>

                {assignForm.sectionId && assignForm.subjectId && (
                  <div className="pt-3 mt-3 border-t space-y-2">
                    <Label>Or ask other departments to lend a faculty member</Label>
                    {/* Tick as many departments as you like - each gets its own request, and the subject can
                        be asked of more departments later even if it already has faculty. */}
                    <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                      {requestableDepartments.length === 0 ? (
                        <p className="px-1 text-xs text-muted-foreground">No other departments</p>
                      ) : requestableDepartments.map((d) => {
                        const parentName = d.parentDepartmentId ? departments.find((p) => p.id === d.parentDepartmentId)?.name : null;
                        const alreadyAsked = assignmentRequests.some((r) =>
                          r.status === "PENDING" && r.sectionId === assignForm.sectionId && r.subjectId === assignForm.subjectId && r.targetDepartmentId === d.id);
                        return (
                          <label key={d.id} className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm ${alreadyAsked ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}>
                            <Checkbox
                              checked={requestTargetIds.includes(d.id)}
                              disabled={alreadyAsked}
                              onCheckedChange={(v) => setRequestTargetIds((ids) => (v === true ? [...ids, d.id] : ids.filter((x) => x !== d.id)))}
                            />
                            <span>{d.name}{parentName ? ` (${parentName})` : ""}</span>
                            {alreadyAsked && <span className="text-[10px] text-muted-foreground">already requested</span>}
                          </label>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      loading={sendingRequest}
                      disabled={requestTargetIds.length === 0}
                      onClick={() => void handleSendRequest()}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {requestTargetIds.length > 1 ? `Send requests to ${requestTargetIds.length} departments` : "Send Request"}
                    </Button>
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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Current Assignments</CardTitle>
            {/* Only once Load has applied a filter to follow. */}
            {applied && course && !isLoading && assignments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {showAllAssignments
                    ? `Showing all ${assignments.length} assignments`
                    : `Showing ${course.name} · ${ordinalYear(Number(year))}${effectiveSemester != null ? ` · Sem ${effectiveSemester}` : ""}${departmentFilter ? ` · ${departmentFilter}` : ""}${hiddenAssignmentCount > 0 ? ` - ${hiddenAssignmentCount} other${hiddenAssignmentCount === 1 ? "" : "s"} hidden` : ""}`}
                </span>
                {(showAllAssignments || hiddenAssignmentCount > 0) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAllAssignments((v) => !v)}>
                    {showAllAssignments ? "Follow filters" : "Show all"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments yet.</p>
          ) : assignmentsInView.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No teaching assignments yet for this selection{hiddenAssignmentCount > 0 ? " - use Show all to see the others" : ""}.
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {g.courseName} · {ordinalYear(g.year)} ·{" "}
                      {/* Department included: two sections can share a letter. */}
                      {g.department ? `${departmentCode(g.department, departments)} ` : ""}
                      Section {g.sectionName}
                    </p>
                    {g.items.some((a) => a.accessLevel !== "secondary") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => setResetTarget({
                          sectionId: g.sectionId,
                          label: `${g.courseName} ${ordinalYear(g.year)} ${g.department ? `${departmentCode(g.department, departments)} ` : ""}Section ${g.sectionName}`,
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />Delete all
                      </Button>
                    )}
                  </div>
                  <div className="divide-y rounded-md border">
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {a.subjectName} <span className="text-muted-foreground">({a.shortCode || a.subjectCode})</span>
                            {a.timetableSemester != null && <Badge variant="outline" className="text-xs">Sem {a.timetableSemester}</Badge>}
                            {a.accessLevel === "secondary" && <Badge variant="secondary" className="text-xs">View only</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">{a.facultyName} · {a.hoursPerWeek} hrs/wk</p>
                        </div>
                        {a.accessLevel !== "secondary" && (
                          <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(a)}>
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
                            {a.subjectName} <span className="text-muted-foreground">({a.shortCode || a.subjectCode})</span>
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
                          <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(a)}>
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

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open && !resetting) setResetTarget(null); }}
        title="Delete assignments and requests for this section?"
        description={(() => {
          if (!resetTarget) return undefined;
          const assignmentCount = assignments.filter((a) => a.sectionId === resetTarget.sectionId && !a.isPast).length;
          const requestCount = assignmentRequests.filter((r) => r.sectionId === resetTarget.sectionId && (r.status === "PENDING" || r.status === "ALLOCATED")).length;
          const counts = `${assignmentCount} teaching assignment${assignmentCount === 1 ? "" : "s"} and ${requestCount} faculty request${requestCount === 1 ? "" : "s"}`;
          return `${resetTarget.label}${effectiveSemester != null ? ` (Semester ${effectiveSemester})` : ""}: this will permanently delete ${counts}, plus the whole timetable booked for them (published and draft), so every subject shows fresh and unstaffed. This cannot be undone. Do you want to delete?`;
        })()}
        confirmLabel="Yes, delete"
        cancelLabel="No, keep"
        variant="destructive"
        loading={resetting}
        onConfirm={() => { if (resetTarget) void handleResetSection(resetTarget.sectionId); }}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.subjectName ?? "this"} assignment?`}
        description={`This will remove ${removeTarget?.facultyName ?? "the faculty member"}'s assignment to ${removeTarget?.subjectName ?? "this subject"}.`}
        confirmLabel="Remove"
        variant="destructive"
        loading={removing}
        onConfirm={() => { if (removeTarget) void handleRemove(removeTarget.id); }}
      />
    </div>
  );
}
