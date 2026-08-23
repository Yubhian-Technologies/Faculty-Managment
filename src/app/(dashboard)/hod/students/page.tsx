"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shuffle, Pencil, Layers, ArrowRightLeft, CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { RosterDetailView, yearOptionsForDepartment, yearOptionsForCourse } from "@/components/students/RosterFieldInputs";
import { structureFromDepartments, noOwnSectionsChildren, expandDepartmentNameForRollup, type DepartmentWithId } from "@/lib/college/academicStructure";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { disambiguateSectionLabels, sectionFeedsTarget } from "@/lib/sections/sectionLabel";
import type { StudentListItem, Section, Department, Course, AcademicYear } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;
type SectionRow = Section & { id: string; accessLevel?: "primary" | "secondary" };

interface CohortBranchResult {
  branch: string;
  managedBy?: string;
  distributed: number;
  perSection: { section: string; count: number }[];
  skippedReason?: string;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "outline",
  GRADUATED: "secondary",
};

export default function HodStudentsPage() {
  const router = useRouter();
  const myDepartments = useMyDepartments();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("all");
  // Matches the College Office Students page's own filter row (Course/
  // Department/Year) - this table previously only offered Department, with no
  // way to narrow a large mixed roster down to one course or year at a glance.
  const [courseFilter, setCourseFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  // "none" = the normal, manageable roster below (this HOD's own students -
  // accessLevel "primary"). Any other value is one of the Freshman's
  // Departments currently holding students pre-registered toward one of this
  // HOD's own departments (Core Dept) - switches the table to a READ-ONLY
  // view of just those. Same data the old, separate "First Year Students"
  // page showed; folded in here as an explicit view switch instead of its own
  // route, and still deliberately view-only (no Assign/Edit) - these aren't
  // this HOD's students to manage until they're actually distributed/
  // promoted into one of their own real sections.
  const [freshmanView, setFreshmanView] = useState("none");

  const [cohortOpen, setCohortOpen] = useState(false);
  const [cohortResult, setCohortResult] = useState<CohortBranchResult[] | null>(null);
  const [isDistributingCohort, setIsDistributingCohort] = useState(false);

  const [distributeOpen, setDistributeOpen] = useState(false);
  const [distDept, setDistDept] = useState("");
  // The real branch to route through, when distDept is a shared-first-year
  // grouping department (e.g. "BS-Mathematics") whose sections are filed under
  // the branches it manages (e.g. "cse"), never under itself.
  const [distBranch, setDistBranch] = useState("");
  const [distYear, setDistYear] = useState("");
  // Only asked for when the filtered unassigned cohort itself spans more than
  // one course (distCohortCourseIds below) - a department running two courses
  // (e.g. B.Tech and M.Tech) can have unassigned students pending for both at
  // once, and target sections must be scoped to exactly one (see
  // StudentRecord.courseId's doc-comment).
  const [distCourseId, setDistCourseId] = useState("");
  const [distSectionIds, setDistSectionIds] = useState<string[]>([]);
  const [isDistributing, setIsDistributing] = useState(false);

  const [editTarget, setEditTarget] = useState<StudentRow | null>(null);
  const [editRoll, setEditRoll] = useState("");
  const [editStatus, setEditStatus] = useState("REGULAR");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Full read-only profile (every roster field, same RosterDetailView the
  // College Office Students page already shows) - opened by clicking a row,
  // same as Office's own table.
  const [viewTarget, setViewTarget] = useState<StudentRow | null>(null);

  // Per-student section assignment - the same move the bulk Distribute dialog
  // does for a whole cohort, but for one student at a time (e.g. placing the
  // handful left over after an uneven bulk split, or moving someone who was
  // sectioned wrong). Reuses students/[id] PATCH's targetSectionId move, which
  // already corrects `department` to the section's own and resolves/clears
  // secondaryDepartment - the single-student counterpart of the bulk fix above.
  const [assignTarget, setAssignTarget] = useState<StudentRow | null>(null);
  const [assignSectionId, setAssignSectionId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const [studentsRes, sectionsRes, deptsRes, coursesRes, yearsRes] = await Promise.all([
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRow[] }>),
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
      ]);
      setStudents(studentsRes.students ?? []);
      setSections(sectionsRes.sections ?? []);
      setDepartments(deptsRes.departments ?? []);
      setCourses(coursesRes.courses ?? []);
      setAcademicYears(yearsRes.academicYears ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Wrapped so the loader's setState calls aren't synchronously reachable
    // from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, []);

  // Only departments the sub-HOD fully manages (primary sections) can be
  // distributed / sectioned - a genuinely cross-listed (secondary) section
  // belongs to someone else.
  const managedSections = useMemo(
    () => sections.filter((s) => s.accessLevel !== "secondary"),
    [sections]
  );
  // Every real branch owns its own Course document for a programme it runs
  // (see StudentRecord.courseId's doc-comment) - a shared-first-year
  // section's own courseId is picked ad hoc by whoever created it (some use
  // the common department's Course doc, some use the real branch's own -
  // both legitimate), so two sections of the EXACT SAME programme can easily
  // carry different courseId values without being a genuine course mismatch
  // at all. catalogId is the field that's actually shared across every
  // department's own copy - used below (Distribute and Assign) to recognize
  // that case instead of wrongly treating "different Course document" as
  // "different course" and hiding a real, correct section. Mirrors the
  // identical fix in distribute/route.ts and distribute-cohort/route.ts.
  const catalogIdByCourseId = useMemo(
    () => new Map(courses.map((c) => [c.id, c.catalogId])),
    [courses]
  );
  const sameProgramme = useCallback((a: string | undefined, b: string | undefined): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    const catA = catalogIdByCourseId.get(a);
    return !!catA && catA === catalogIdByCourseId.get(b);
  }, [catalogIdByCourseId]);
  // Restricted to departments this HOD actually structurally has - built from
  // students they own/manage (accessLevel !== "secondary" - a merely
  // cross-listed, view-only student's OWN department belongs to whoever
  // really runs it, not this HOD) and their OWN `department` field, never
  // `secondaryDepartment` ("Core Dept"). Core Dept is a different, forward-
  // looking dimension - which real branch a shared-first-year student is
  // eventually headed for, not where they currently, structurally sit -  and
  // used to be folded in here too, which let this list roll in every
  // downstream branch ANY visible shared-year cohort happens to be pre-
  // registered toward (e.g. AIML, CIVIL, another sub-department's own managed
  // branch this HOD has no real relationship to) as if it were one of this
  // HOD's own departments. Also synthesizes in a "no own sections"
  // shared-first-year parent (e.g. VISHNU's "BASIC SCIENCE") whenever any of
  // its children already appear - such a parent never itself shows up in
  // student data (it never houses a student directly), so without this it
  // could never be picked at all even though `filtered` below already handles
  // it correctly as a rollup target.
  const departmentNames = useMemo(() => {
    const names = new Set(
      students.filter((s) => s.accessLevel !== "secondary").map((s) => s.department).filter((d): d is string => !!d)
    );
    const allDepts = departments as DepartmentWithId[];
    for (const d of allDepts) {
      if (!d.name) continue;
      const children = noOwnSectionsChildren(allDepts, d.name);
      if (children && children.some((c) => names.has(c.name))) names.add(d.name);
    }
    return Array.from(names).sort();
  }, [students, departments]);
  // Students currently held by some OTHER (Freshman's) department who are
  // pre-registered toward one of THIS HOD's own departments - accessLevel
  // "secondary" (students/route.ts's own secondaryQuery: secondaryDepartment
  // matches one of this HOD's own/child department names). View-only: they
  // aren't this HOD's to edit/assign until distributed/promoted into one of
  // their own real sections - drives the Freshman's Department selector
  // below rather than being mixed into the manageable roster.
  const incomingStudents = useMemo(
    () => students.filter((s) => s.accessLevel === "secondary"),
    [students]
  );
  // Which Freshman's Department(s) are actually holding any such students -
  // a college can run more than one, independent of the others (see
  // getFreshmanDepartmentIds's own doc-comment), so this lets the selector
  // below only ever offer ones that actually have someone pre-registered
  // toward this HOD right now.
  const freshmanDeptOptions = useMemo(
    () => Array.from(new Set(incomingStudents.map((s) => s.department).filter(Boolean))).sort(),
    [incomingStudents]
  );
  const isFreshmanView = freshmanView !== "none";
  const incomingFiltered = useMemo(
    () => (isFreshmanView ? incomingStudents.filter((s) => s.department === freshmanView) : []),
    [incomingStudents, freshmanView, isFreshmanView]
  );
  // Unassigned students this HOD can actually section - excludes view-only
  // ("secondary") cross-listed students, e.g. someone else's branch merely
  // pre-registered here. Drives the Department/Year pickers below so a branch
  // with unassigned students but no sections *yet* still shows up (steering
  // the HOD to create sections first) instead of the pickers looking empty.
  const unassignedStudents = useMemo(
    () => students.filter((s) => !s.section && s.accessLevel !== "secondary"),
    [students]
  );
  const distDepartments = useMemo(
    () => Array.from(new Set(unassignedStudents.map((s) => s.department).filter(Boolean))).sort(),
    [unassignedStudents]
  );
  // The real branches distDept's unassigned students are pre-registered to
  // (e.g. "cse", "IT" under "BS-Mathematics") - present only for a
  // shared-first-year grouping department, since a plain department's
  // students carry no secondaryDepartment at all. Forces the branch pick
  // below before sections (filed under the branch, never the grouping
  // department) can be found.
  const distBranches = useMemo(
    () => Array.from(new Set(
      unassignedStudents.filter((s) => s.department === distDept).map((s) => s.secondaryDepartment).filter(Boolean)
    )).sort() as string[],
    [unassignedStudents, distDept]
  );
  // Which department sections/placement actually resolve against - the chosen
  // branch once one is required and picked, otherwise distDept itself.
  const distTargetDept = distBranches.length > 0 ? distBranch : distDept;
  // The unassigned cohort narrowed to (department, branch) - reused below for
  // both the Year options and, once a year is also picked, the course check.
  const distCohortByDeptBranch = useMemo(
    () => unassignedStudents.filter((s) =>
      s.department === distDept && (distBranches.length === 0 || s.secondaryDepartment === distBranch)
    ),
    [unassignedStudents, distDept, distBranch, distBranches.length]
  );
  const distYears = useMemo(
    () => Array.from(new Set(distCohortByDeptBranch.map((s) => s.year))).sort((a, b) => a - b),
    [distCohortByDeptBranch]
  );
  const distCohortByYear = useMemo(
    () => distCohortByDeptBranch.filter((s) => String(s.year) === distYear),
    [distCohortByDeptBranch, distYear]
  );
  // Distinct courses this (department, branch, year) cohort has actually
  // declared (StudentRecord.courseId - blank/undeclared students are excluded,
  // since they impose no constraint). A department running two courses (e.g.
  // B.Tech and M.Tech) can have unassigned students pending for both at once -
  // target sections must be scoped to exactly one course (a department can run
  // a same-named section under more than one - see StudentRecord.courseId's
  // doc-comment), so a genuinely mixed cohort needs an explicit pick below
  // rather than silently offering every course's sections together.
  const distCohortCourseIds = useMemo(
    () => Array.from(new Set(distCohortByYear.map((s) => s.courseId).filter((c): c is string => !!c))),
    [distCohortByYear]
  );
  // Whether this cohort is genuinely mixed-PROGRAMME, not just spread across
  // more than one Course document of the exact same programme (see
  // catalogIdByCourseId's own doc-comment above) - the thing that actually
  // needs an explicit pick below.
  const distCohortCatalogIds = useMemo(
    () => Array.from(new Set(distCohortCourseIds.map((id) => catalogIdByCourseId.get(id)).filter((c): c is string => !!c))),
    [distCohortCourseIds, catalogIdByCourseId]
  );
  // One representative courseId per genuinely distinct programme, for the
  // Course picker below - without this, two courseIds of the exact same
  // programme (see catalogIdByCourseId's own doc-comment) would show as two
  // identically-labeled "Bachelor of Technology" options.
  const distCohortProgrammeOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const cid of distCohortCourseIds) {
      const key = catalogIdByCourseId.get(cid) ?? cid;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(cid);
    }
    return options;
  }, [distCohortCourseIds, catalogIdByCourseId]);
  // Automatic when the cohort is uniform (0 or 1 distinct PROGRAMME declared -
  // any one of its actual courseIds works, since sameProgramme treats them as
  // interchangeable below), otherwise whatever was explicitly picked via the
  // Course selector.
  const effectiveDistCourseId = distCohortCatalogIds.length <= 1 ? distCohortCourseIds[0] : distCourseId;
  const distTargetSections = useMemo(() => {
    const base = managedSections.filter((s) =>
      sectionFeedsTarget(s, distDept, distBranches.length > 0 ? distBranch : "")
      && String(s.year) === distYear
    );
    // Same softened rule as the per-student Assign dialog's assignTargetSections
    // (see its own comment) - the cohort's declared courseId only disambiguates
    // when the matching sections themselves actually span more than one
    // genuinely different PROGRAMME (catalogId); it must never be able to hide
    // a real section just because it happens to use a different Course
    // document of the exact same programme than however the cohort's own
    // courseId was resolved (see catalogIdByCourseId's own doc-comment).
    const distinctCatalogIds = new Set(base.map((s) => catalogIdByCourseId.get(s.courseId ?? "")).filter(Boolean));
    if (effectiveDistCourseId && distinctCatalogIds.size > 1) {
      const narrowed = base.filter((s) => sameProgramme(s.courseId, effectiveDistCourseId));
      if (narrowed.length > 0) return narrowed.sort((a, b) => a.name.localeCompare(b.name));
    }
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }, [managedSections, distDept, distBranch, distBranches.length, distYear, effectiveDistCourseId, catalogIdByCourseId, sameProgramme]);
  // A department can run the same section name under more than one course
  // (e.g. "IT-A" under both B.Tech and M.Tech) - this list isn't scoped to a
  // single course, so identical-looking checkboxes need the course name added
  // to tell them apart. Sections that are already unique are left as-is.
  const distSectionLabels = useMemo(
    () => disambiguateSectionLabels(distTargetSections, departments),
    [distTargetSections, departments]
  );
  const unassignedCount = useMemo(() => {
    // A mixed-PROGRAMME cohort with no course picked yet isn't actionable -
    // showing "everyone" here would overcount (some belong to a different
    // course). Not triggered merely by more than one Course DOCUMENT being
    // present, same distinction as distTargetSections above.
    if (distCohortCatalogIds.length > 1 && !distCourseId) return 0;
    return distCohortByYear.filter((s) => !effectiveDistCourseId || !s.courseId || sameProgramme(s.courseId, effectiveDistCourseId)).length;
  }, [distCohortByYear, distCohortCatalogIds.length, distCourseId, effectiveDistCourseId, sameProgramme]);

  // Distinct programme names this HOD's departments actually offer - same
  // "distinct names of the raw Course docs" reduction the Office Students
  // page uses for its own Course filter.
  const courseNames = useMemo(
    () => Array.from(new Set(courses.map((c) => c.name?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b)),
    [courses]
  );
  // Fallback years for when neither Department nor Course narrows things
  // down yet - same fallback chain as the Office Students page: prefer what
  // the college has configured, fall back to whatever years already appear
  // on students, then to 1-4 so the filter is never empty.
  const fallbackYears = useMemo(() => {
    const configured = academicYears.map((y) => y.yearNumber).filter(Boolean);
    const fromStudents = Array.from(new Set(students.map((s) => s.year).filter(Boolean)));
    const merged = Array.from(new Set([...configured, ...fromStudents])).sort((a, b) => a - b);
    // The college-wide Academic Years list (Principal-managed, sequential
    // add/remove) has no idea which years any real course actually reaches -
    // it can carry more years than the longest course this HOD's departments
    // offer (e.g. a stray "5th Year" nothing under BTech's 4-year span ever
    // uses), which would otherwise sit in this filter as a dead option that
    // can never match a student. `courses` is already scoped to this HOD's
    // own departments (see /api/college/courses's HOD handling), so its
    // longest `durationYears` is the real ceiling here - the same cap the
    // Principal's own Years Taught editor already enforces at the source.
    const maxCourseDuration = courses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
    const capped = maxCourseDuration > 0 ? merged.filter((y) => y <= maxCourseDuration) : merged;
    return capped.length > 0 ? capped : [1, 2, 3, 4];
  }, [academicYears, students, courses]);

  // Department -> Year cascade, same one the Office Students page's own
  // filter bar uses (yearOptionsForDepartment/yearOptionsForCourse) - a
  // department only offers the years it's actually assigned to teach for the
  // chosen course (managerEffectiveYears), so picking a Freshman's Department
  // like "Basic Science - Maths" narrows Year down to just 1st Year instead
  // of still offering every year this HOD's *other*, non-freshman departments
  // happen to reach. Without this, the filter fell back to fallbackYears
  // unconditionally - capped only by the longest course duration anywhere in
  // this HOD's scope, so a pure Freshman's-Department HOD (whose students
  // never leave Year 1) still saw a dead "2nd/3rd/4th Year" option that could
  // never match anything.
  const yearFilterOptions = useMemo(() => {
    if (deptFilter !== "all") {
      return yearOptionsForDepartment(departments, courses, deptFilter, courseFilter === "all" ? "" : courseFilter, fallbackYears);
    }
    return yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, fallbackYears);
  }, [deptFilter, courseFilter, departments, courses, fallbackYears]);

  // A "no own sections" shared-first-year parent (e.g. VISHNU's "BASIC
  // SCIENCE") never itself houses a student - picking it as a filter rolls
  // up to match its children's students too (see
  // expandDepartmentNameForRollup's own doc-comment). A no-op for every
  // other department, same exact-match behaviour as before.
  const deptFilterRollupNames = useMemo(
    () => (deptFilter !== "all" ? expandDepartmentNameForRollup(departments as DepartmentWithId[], deptFilter) : null),
    [departments, deptFilter]
  );

  const filtered = useMemo(
    () => students.filter((s) => {
      // The manage table is this HOD's OWN roster only - a merely
      // cross-listed (accessLevel "secondary") student, pre-registered toward
      // one of this HOD's departments while still held by a Freshman's
      // Department elsewhere, isn't theirs to edit/assign yet. Surfaced
      // separately, view-only, via the Freshman's Department selector below
      // (incomingStudents/incomingFiltered).
      if (s.accessLevel === "secondary") return false;
      if (deptFilterRollupNames && !deptFilterRollupNames.includes(s.department)) return false;
      if (courseFilter !== "all" && s.course !== courseFilter) return false;
      if (yearFilter !== "all" && s.year !== Number(yearFilter)) return false;
      return true;
    }),
    [students, deptFilterRollupNames, courseFilter, yearFilter]
  );

  // Sections a single student can be assigned into - their real branch's (if
  // pre-registered to one via secondaryDepartment) or their own department's,
  // for their own year. Same resolution the bulk Distribute dialog uses.
  //
  // The student's own `courseId` (StudentRecord.courseId) is used to
  // disambiguate ONLY when the matching sections themselves actually span
  // more than one distinct course (e.g. a department running both a B.Tech
  // and an independent M.Tech) - never as a hard, unconditional filter. It's
  // merely a best-effort "declared intent" for a student who was never
  // placed into a real section yet (see the field's own doc-comment), and a
  // shared-first-year section's OWN course doc is picked ad hoc by whoever
  // created it (some use the common department's, some use the real
  // branch's own - both are legitimate, and nothing keeps them in sync with
  // however a given student's courseId was resolved at import/add time).
  // Filtering on it unconditionally could silently hide every real,
  // correctly-department/year-matching section a student should actually be
  // assignable to, showing "no sections yet" even though several exist.
  const assignTargetSections = useMemo(() => {
    if (!assignTarget) return [];
    const base = managedSections.filter((s) =>
      sectionFeedsTarget(s, assignTarget.department, assignTarget.secondaryDepartment ?? "")
      && s.year === assignTarget.year
      // Exclude the section the student is already sitting in - listing it
      // as a "Move" target read as "already in this section" and picking
      // it would just be a no-op re-assign.
      && s.name !== assignTarget.section
    );
    // Disambiguates only when the matching sections actually span more than
    // one genuinely different PROGRAMME (catalogId), not merely more than
    // one Course document of the exact same programme - see
    // catalogIdByCourseId's own doc-comment above for why those two docs can
    // legitimately differ for a shared-first-year section.
    const distinctCatalogIds = new Set(base.map((s) => catalogIdByCourseId.get(s.courseId ?? "")).filter(Boolean));
    if (assignTarget.courseId && distinctCatalogIds.size > 1) {
      const narrowed = base.filter((s) => sameProgramme(s.courseId, assignTarget.courseId));
      if (narrowed.length > 0) return narrowed.sort((a, b) => a.name.localeCompare(b.name));
    }
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }, [assignTarget, managedSections, catalogIdByCourseId, sameProgramme]);
  const assignSectionLabels = useMemo(
    () => disambiguateSectionLabels(assignTargetSections, departments),
    [assignTargetSections, departments]
  );

  // The cohort action belongs to the main HOD of a shared first-year department
  // only - a core branch HOD sections their own students with the per-department
  // dialog. Derived with the same helper the API uses, so both agree.
  const structure = useMemo(
    () => structureFromDepartments(departments as DepartmentWithId[]),
    [departments]
  );
  const cohortYear = structure.commonYears[0];
  const isCommonYearHod =
    structure.isCommonFirstYear &&
    !!structure.commonDepartment &&
    myDepartments.includes(structure.commonDepartment.name);
  const cohortUnassignedCount = useMemo(
    () => (cohortYear ? students.filter((s) => s.year === cohortYear && !s.section).length : 0),
    [students, cohortYear]
  );

  async function handleDistributeCohort() {
    if (!cohortYear) return;
    setIsDistributingCohort(true);
    try {
      const res = await fetch("/api/college/students/distribute-cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: cohortYear }),
      });
      const json = await res.json() as {
        error?: string; distributed?: number; perBranch?: CohortBranchResult[];
      };
      if (!res.ok) {
        // A failed run can still carry per-branch detail (e.g. every branch is
        // missing sections) - surface it rather than just the message.
        setCohortResult(json.perBranch ?? null);
        throw new Error(json.error ?? "Failed to distribute");
      }
      setCohortResult(json.perBranch ?? []);
      toast({ variant: "success", title: `Distributed ${json.distributed} students` });
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to distribute" });
    } finally {
      setIsDistributingCohort(false);
    }
  }

  // Mirrors the Office Students page's own onCourseFilterChange/
  // onDeptFilterChange: dropping a previously-picked Year that no longer
  // applies once Department/Course narrows the cascade, rather than leaving
  // a stale value selected that can now match nothing.
  function onCourseFilterChange(value: string) {
    const nextYearOptions = deptFilter !== "all"
      ? yearOptionsForDepartment(departments, courses, deptFilter, value === "all" ? "" : value, fallbackYears)
      : yearOptionsForCourse(courses, value === "all" ? undefined : value, fallbackYears);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCourseFilter(value);
  }

  function onDeptFilterChange(value: string) {
    const nextYearOptions = value !== "all"
      ? yearOptionsForDepartment(departments, courses, value, courseFilter === "all" ? "" : courseFilter, fallbackYears)
      : yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, fallbackYears);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setDeptFilter(value);
  }

  function toggleDistSection(id: string, checked: boolean) {
    setDistSectionIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  function openEdit(student: StudentRow) {
    setEditTarget(student);
    setEditRoll(student.rollNumber ?? "");
    setEditStatus(student.status ?? "REGULAR");
  }

  function openAssign(student: StudentRow) {
    setAssignTarget(student);
    setAssignSectionId("");
  }

  async function handleAssign() {
    if (!assignTarget || !assignSectionId) return;
    setIsAssigning(true);
    try {
      const res = await fetch(`/api/college/students/${assignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSectionId: assignSectionId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to assign section");
      toast({ variant: "success", title: `${assignTarget.name} assigned` });
      setAssignTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to assign section" });
    } finally {
      setIsAssigning(false);
    }
  }

  // Removes a student from their current section back to "Unassigned" -
  // keeps the student record (roll number, department, course intact),
  // unlike the row's separate delete action which removes them outright.
  async function handleUnassign() {
    if (!assignTarget) return;
    setIsUnassigning(true);
    try {
      const res = await fetch(`/api/college/students/${assignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unassign: true }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to unassign");
      toast({ variant: "success", title: `${assignTarget.name} unassigned` });
      setAssignTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to unassign" });
    } finally {
      setIsUnassigning(false);
    }
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/college/students/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollNumber: editRoll.trim(), status: editStatus }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update student");
      toast({ variant: "success", title: "Student updated" });
      setEditTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update student" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDistribute() {
    if (!distDept || (distBranches.length > 0 && !distBranch) || !distYear || distSectionIds.length === 0) {
      toast({ variant: "destructive", title: "Pick a department, year, and at least one section" });
      return;
    }
    setIsDistributing(true);
    try {
      const res = await fetch("/api/college/students/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: distDept,
          ...(distBranch ? { secondaryDepartment: distBranch } : {}),
          year: Number(distYear),
          sectionIds: distSectionIds,
        }),
      });
      const json = await res.json() as { error?: string; distributed?: number; perSection?: { section: string; count: number }[] };
      if (!res.ok) throw new Error(json.error ?? "Failed to distribute");
      const summary = (json.perSection ?? []).map((p) => `${p.section}: ${p.count}`).join(", ");
      toast({ variant: "success", title: `Distributed ${json.distributed} students`, description: summary });
      setDistributeOpen(false);
      setDistCourseId("");
      setDistSectionIds([]);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to distribute" });
    } finally {
      setIsDistributing(false);
    }
  }

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Roll No", render: (r) => <span className="font-medium">{r.rollNumber || "—"}</span> },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", hideOnMobile: true, render: (r) => <span className="text-sm text-muted-foreground">{r.department}</span> },
    {
      key: "course",
      header: "Course",
      hideOnMobile: true,
      // Kept in sync with whichever section a student is actually placed
      // into (see StudentRecord.courseId's doc-comment) - a department can
      // run more than one course, so this is the only reliable way to tell,
      // at a glance, which one a given row belongs to (the same section name
      // can exist under two different courses).
      render: (r) => r.course
        ? <span className="text-sm text-muted-foreground">{r.course}</span>
        : <span className="text-sm text-muted-foreground/40">—</span>,
    },
    {
      key: "secondaryDepartment",
      header: "Core Dept",
      hideOnMobile: true,
      // Only ever set for a shared-first-year student pre-registered to their
      // real branch (e.g. "cse" under "BS-Mathematics") - a plain department's
      // students, and a first-year already sectioned into their branch, carry
      // none, so this reads as a blank dash for them.
      render: (r) => r.secondaryDepartment
        ? <span className="text-sm text-muted-foreground">{r.secondaryDepartment}</span>
        : <span className="text-sm text-muted-foreground/40">—</span>,
    },
    {
      key: "section",
      header: "Section",
      render: (r) =>
        r.section
          ? <span>{r.section}</span>
          : <Badge variant="outline" className="text-amber-600 border-amber-300">Unassigned</Badge>,
    },
    { key: "year", header: "Year", hideOnMobile: true, render: (r) => <span>{r.year}</span> },
    {
      key: "semester",
      header: "Semester",
      hideOnMobile: true,
      render: (r) => r.semester
        ? <span className="text-sm text-muted-foreground">{r.semester}</span>
        : <span className="text-sm text-muted-foreground/40">—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>{r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        // stopPropagation - the row itself opens the full read-only profile
        // on click (onRowClick below), which these actions must not trigger.
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/hod/students/${r.id}/attendance?name=${encodeURIComponent(r.name)}`)}
            title="View attendance history"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openAssign(r)} title={r.section ? "Move to a different section" : "Assign to a section"}>
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Set roll number / status">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Your department's students, plus every branch grouped under it. Divide unassigned students evenly across sections in full-name order."
        actions={!isFreshmanView && (
          <>
          {isCommonYearHod && (
            <Dialog open={cohortOpen} onOpenChange={(open) => { setCohortOpen(open); if (!open) setCohortResult(null); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Layers className="h-4 w-4 mr-2" />
                  Distribute All {cohortYear ? yearOrdinalLabel(cohortYear) : ""} Students
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    Distribute the whole {cohortYear ? yearOrdinalLabel(cohortYear) : ""} intake
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Every unassigned student is placed into a section of <strong>their own branch</strong> - an IT
                    student always lands in an IT section, never in a sub-department. Within each branch they are
                    sorted by full name and split evenly across that branch&apos;s sections. Branches with no
                    sections yet are reported and left untouched.
                  </p>
                  <p className="text-sm">
                    <strong>{cohortUnassignedCount}</strong> unassigned student
                    {cohortUnassignedCount === 1 ? "" : "s"} across{" "}
                    {structure.subDepartments.length} sub-department
                    {structure.subDepartments.length === 1 ? "" : "s"}.
                  </p>

                  {cohortResult && (
                    <div className="space-y-2 rounded-md border p-3 max-h-64 overflow-y-auto">
                      {cohortResult.map((b) => (
                        <div key={b.branch} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{b.branch}</span>
                            {b.skippedReason ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-300">Skipped</Badge>
                            ) : (
                              <span className="text-muted-foreground">{b.distributed} placed</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {b.skippedReason
                              ?? b.perSection.map((p) => `${p.section}: ${p.count}`).join(", ")}
                            {b.managedBy && !b.skippedReason ? ` · managed by ${b.managedBy}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCohortOpen(false)}>Close</Button>
                  <Button
                    onClick={() => void handleDistributeCohort()}
                    loading={isDistributingCohort}
                    disabled={cohortUnassignedCount === 0}
                  >
                    Distribute All
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Dialog
            open={distributeOpen}
            onOpenChange={(open) => {
              setDistributeOpen(open);
              if (!open) { setDistBranch(""); setDistCourseId(""); setDistSectionIds([]); }
            }}
          >
            <DialogTrigger asChild>
              <Button><Shuffle className="h-4 w-4 mr-2" />Distribute Unassigned</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Distribute Unassigned Students</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Unassigned students are sorted by full name and split evenly across the sections you pick - earliest
                  names fill the first section, and so on. Roll numbers stay as imported.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select
                      value={distDept}
                      onValueChange={(v) => { setDistDept(v); setDistBranch(""); setDistYear(""); setDistCourseId(""); setDistSectionIds([]); }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {distDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Only a shared-first-year grouping department (e.g.
                      "BS-Mathematics") has branches here - its sections are
                      filed under the real branch (cse, IT, ...), never under
                      itself, so the branch has to be picked before sections
                      can be found at all. A plain department skips straight
                      to Year, unchanged from before. */}
                  {distBranches.length > 0 ? (
                    <div className="space-y-2">
                      <Label>Core Department</Label>
                      <Select
                        value={distBranch}
                        onValueChange={(v) => { setDistBranch(v); setDistYear(""); setDistCourseId(""); setDistSectionIds([]); }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                        <SelectContent>
                          {distBranches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Select value={distYear} onValueChange={(v) => { setDistYear(v); setDistCourseId(""); setDistSectionIds([]); }} disabled={!distDept}>
                        <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                        <SelectContent>
                          {distYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {distBranches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Year</Label>
                    <Select
                      value={distYear}
                      onValueChange={(v) => { setDistYear(v); setDistCourseId(""); setDistSectionIds([]); }}
                      disabled={!distBranch}
                    >
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {distYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Only shown when this (department, branch, year) cohort
                    itself has unassigned students declared for more than one
                    genuinely different PROGRAMME - the common case (one
                    programme, or none declared, even if spread across more
                    than one Course document of that same programme - see
                    catalogIdByCourseId's own doc-comment) skips straight to
                    Target Sections. */}
                {distDept && (distBranches.length === 0 || distBranch) && distYear && distCohortCatalogIds.length > 1 && (
                  <div className="space-y-2">
                    <Label>Course</Label>
                    <Select
                      value={distCourseId}
                      onValueChange={(v) => { setDistCourseId(v); setDistSectionIds([]); }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                      <SelectContent>
                        {distCohortProgrammeOptions.map((cid) => (
                          <SelectItem key={cid} value={cid}>{courses.find((c) => c.id === cid)?.name ?? cid}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      This department has unassigned students declared for more than one course - pick which one to distribute.
                    </p>
                  </div>
                )}

                {distDept && (distBranches.length === 0 || distBranch) && distYear && (distCohortCatalogIds.length <= 1 || distCourseId) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Target Sections</Label>
                      <span className="text-xs text-muted-foreground">{unassignedCount} unassigned to divide</span>
                    </div>
                    {distTargetSections.length > 0 ? (
                      <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                        {distTargetSections.map((s) => (
                          <label key={s.id} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={distSectionIds.includes(s.id)}
                              onCheckedChange={(checked) => toggleDistSection(s.id, !!checked)}
                            />
                            {distSectionLabels.get(s.id) ?? s.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                        No sections for {distTargetDept} Year {distYear}
                        {effectiveDistCourseId ? ` (${courses.find((c) => c.id === effectiveDistCourseId)?.name ?? "this course"})` : ""}
                        {" "}yet - create them under Sections first.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDistributeOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => void handleDistribute()}
                  loading={isDistributing}
                  disabled={unassignedCount === 0 || distSectionIds.length === 0}
                >
                  Distribute
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        )}
      />

      {/* Freshman's Department view switch - only shown once there's actually
          someone pre-registered toward this HOD to view. Picking one swaps
          the table below to a read-only preview of just that department's
          held students; "My Students" returns to the normal, manageable
          roster. */}
      {freshmanDeptOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">Freshman&apos;s Department:</span>
          <Select value={freshmanView} onValueChange={setFreshmanView}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">My Students</SelectItem>
              {freshmanDeptOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          {isFreshmanView && (
            <span className="text-xs text-muted-foreground">
              Students pre-registered to your department(s) while still held by {freshmanView} - view only until distributed/promoted.
            </span>
          )}
        </div>
      )}

      <DataTable
        data={isFreshmanView ? incomingFiltered : filtered}
        columns={isFreshmanView ? columns.filter((c) => c.key !== "actions") : columns}
        onRowClick={setViewTarget}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by roll number or name..."
        searchKeys={["rollNumber", "name"] as (keyof StudentRow)[]}
        emptyTitle={isFreshmanView ? "No incoming students here" : "No students yet"}
        emptyDescription={
          isFreshmanView
            ? `No students are currently held by ${freshmanView} and pre-registered to your department(s).`
            : "Once the College Office imports your branches' students, they show up here to be sectioned."
        }
        filterComponent={isFreshmanView ? undefined : (
          <>
            <Select value={courseFilter} onValueChange={onCourseFilterChange}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All courses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={onDeptFilterChange}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departmentNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {yearFilterOptions.map((y) => <SelectItem key={y} value={String(y)}>{yearOrdinalLabel(y)}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
      />

      {/* ── Student detail (full profile, same as College Office sees) ── */}
      <Dialog open={!!viewTarget} onOpenChange={(open) => { if (!open) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewTarget?.name}</DialogTitle>
          </DialogHeader>

          {viewTarget && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Section:</span>
              {viewTarget.section
                ? <Badge variant="secondary" className="text-xs">{viewTarget.section}</Badge>
                : <span className="italic text-muted-foreground">Unassigned</span>}
              <span className="text-muted-foreground ml-3">Status:</span>
              <Badge variant="secondary" className="text-xs">{viewTarget.status}</Badge>
              {viewTarget.accessLevel === "secondary" && (
                <Badge variant="outline" className="text-xs">View only</Badge>
              )}
            </div>
          )}

          {viewTarget && <RosterDetailView student={viewTarget} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            {/* Not offered for a merely cross-listed (view-only) row - see the
                Freshman's Department selector above; only this HOD's own
                students (accessLevel "primary") are theirs to edit. */}
            {viewTarget && viewTarget.accessLevel !== "secondary" && (
              <Button onClick={() => { openEdit(viewTarget); setViewTarget(null); }}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {editTarget?.department} · Year {editTarget?.year} · {editTarget?.section ? `Section ${editTarget.section}` : "Unassigned"}
            </p>
            <div className="space-y-2">
              <Label htmlFor="edit-roll">Roll Number</Label>
              <Input
                id="edit-roll"
                value={editRoll}
                onChange={(e) => setEditRoll(e.target.value)}
                placeholder="e.g. 21A91A0501"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Leave blank to keep the student roll-less for now.</p>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                  <SelectItem value="DETAINED">Detained</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignTarget} onOpenChange={(open) => { if (!open) setAssignTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{assignTarget?.section ? "Move" : "Assign"} {assignTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {assignTarget?.secondaryDepartment
                ? <>Pre-registered to <strong>{assignTarget.secondaryDepartment}</strong> · Year {assignTarget?.year}</>
                : <>{assignTarget?.department} · Year {assignTarget?.year}</>}
              {assignTarget?.section ? ` · currently Section ${assignTarget.section}` : " · currently Unassigned"}
            </p>
            <div className="space-y-2">
              <Label>Section</Label>
              <Select value={assignSectionId} onValueChange={setAssignSectionId}>
                <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                <SelectContent>
                  {assignTargetSections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{assignSectionLabels.get(s.id) ?? s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignTargetSections.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sections yet for {assignTarget?.secondaryDepartment || assignTarget?.department} Year {assignTarget?.year} - create one under Sections first.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            {assignTarget?.section && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => void handleUnassign()}
                loading={isUnassigning}
              >
                Unassign
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleAssign()} loading={isAssigning} disabled={!assignSectionId}>
              {assignTarget?.section ? "Move" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
