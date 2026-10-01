"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shuffle, Pencil, ArrowRightLeft, CalendarCheck } from "lucide-react";
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
import { yearOptionsForDepartment, yearOptionsForCourse } from "@/components/students/RosterFieldInputs";
import { StudentStrengthDashboard } from "@/components/students/StudentStrengthDashboard";
import { StudentsViewTabs } from "@/components/students/StudentsViewTabs";
import { noOwnSectionsChildren, expandDepartmentNameForRollup, type DepartmentWithId } from "@/lib/college/academicStructure";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { disambiguateSectionLabels, sectionFeedsTarget } from "@/lib/sections/sectionLabel";
import { sectionsAcceptingAll } from "@/lib/students/sectionMove";
import type { StudentListItem, Section, Department, Course, AcademicYear } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;
type SectionRow = Section & { id: string; accessLevel?: "primary" | "secondary" };

type BulkMode = "move" | "unassign";
// Response of POST /api/college/students/bulk-move (a dry run returns the plan
// without writing anything).
interface BulkPlan {
  moves: { id: string; name: string; rollNumber: string; from: string; to: string }[];
  skipped: { id: string; name: string; reason: string }[];
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "outline",
  GRADUATED: "secondary",
};

// Selection checkboxes on this list (header "select all" + every row) - same
// treatment as hod/faculty/page.tsx's own SELECT_CHECKBOX_CLASS: a bit larger
// than the shared Checkbox default, with a clear 2px black border and a white
// fill so an unchecked box reads against the white table. Applied via
// className here so the shared Checkbox - used across the app - keeps its
// default look everywhere else.
const SELECT_CHECKBOX_CLASS =
  "h-5 w-5 border-2 border-black bg-white hover:border-primary [&_svg]:h-3.5 [&_svg]:w-3.5 " +
  "data-[state=checked]:border-primary data-[state=indeterminate]:border-primary " +
  "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground";

// Roster (the original page) vs the live Strength report - see
// components/students/StudentStrengthDashboard.tsx.
const HOD_VIEWS = [
  { key: "roster", label: "Students Allocation" },
  { key: "strength", label: "Students Strength" },
] as const;

export default function HodStudentsPage() {
  const router = useRouter();
  const [view, setView] = useState<(typeof HOD_VIEWS)[number]["key"]>("roster");
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
  const [editLabBatch, setEditLabBatch] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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

  // Manual multi-select Move / Assign / Unassign. Selection is tracked by id
  // but only ever ACTED ON through the rows currently in view (selectedStudents
  // below), so a row hidden by a filter can never be moved by accident.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [bulkSectionId, setBulkSectionId] = useState("");
  const [bulkPlan, setBulkPlan] = useState<BulkPlan | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  // "Select by roll number range" - adds every currently-visible (filtered)
  // student whose rollNumber falls between these two, inclusive, to the
  // existing selection (never replaces it, so it composes with ticking
  // individual rows or a previous range). Plain string comparison, not
  // numeric - a real roll number is an alphanumeric code (e.g.
  // "23471A0427"), and as long as the two ends share the same prefix/width
  // (the normal case for one section's contiguous block), lexicographic
  // order matches numeric order on the varying suffix.
  const [rollFrom, setRollFrom] = useState("");
  const [rollTo, setRollTo] = useState("");

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

  // ── Manual multi-select ────────────────────────────────────────────────
  // What's ticked AND visible right now - the only students any bulk action
  // touches.
  const selectedStudents = useMemo(
    () => filtered.filter((s) => selectedIds.has(s.id)),
    [filtered, selectedIds]
  );
  const selectedYears = useMemo(() => Array.from(new Set(selectedStudents.map((s) => s.year))), [selectedStudents]);
  const unassignedInView = useMemo(() => filtered.filter((s) => !s.section), [filtered]);
  const selectedPlacedCount = selectedStudents.filter((s) => s.section).length;
  // "12 unassigned · 3 in A" - a quick read of where the picked students are now.
  const selectedFromSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of selectedStudents) counts.set(s.section || "Unassigned", (counts.get(s.section || "Unassigned") ?? 0) + 1);
    return Array.from(counts.entries()).map(([label, n]) => (label === "Unassigned" ? `${n} unassigned` : `${n} in ${label}`)).join(" · ");
  }, [selectedStudents]);
  // Sections that can take EVERY selected student: one year, and each section
  // must feed each student's own branch. The server re-checks all of this per
  // student; narrowing here just keeps impossible choices off the list.
  const bulkTargetSections = useMemo(() => {
    return sectionsAcceptingAll(managedSections, selectedStudents).sort((a, b) => a.name.localeCompare(b.name));
  }, [managedSections, selectedStudents]);
  const bulkSectionLabels = useMemo(
    () => disambiguateSectionLabels(bulkTargetSections, departments),
    [bulkTargetSections, departments]
  );

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function setAllSelected(rows: StudentRow[], checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) { if (checked) next.add(r.id); else next.delete(r.id); }
      return next;
    });
  }

  // Adds every currently-filtered student whose rollNumber falls between
  // rollFrom/rollTo (inclusive, whichever order they were typed in) to the
  // selection, so an HOD can tick e.g. 23471A0401-23471A0460 in one go
  // instead of checking 60 rows by hand, then run the existing Move/Assign
  // bulk action on the result.
  function selectRollRange() {
    const from = rollFrom.trim().toUpperCase();
    const to = rollTo.trim().toUpperCase();
    if (!from || !to) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const matches = filtered.filter((s) => {
      const roll = (s.rollNumber ?? "").toUpperCase();
      return roll >= lo && roll <= hi;
    });
    if (matches.length === 0) {
      toast({ variant: "destructive", title: `No students found with roll numbers between ${lo} and ${hi}` });
      return;
    }
    setAllSelected(matches, true);
    toast({ variant: "success", title: `${matches.length} student${matches.length === 1 ? "" : "s"} selected (roll ${lo} - ${hi})` });
  }

  async function requestBulk(body: Record<string, unknown>): Promise<BulkPlan & { moved: number }> {
    const res = await fetch("/api/college/students/bulk-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentIds: selectedStudents.map((s) => s.id), ...body }),
    });
    const json = await res.json() as { error?: string; moves?: BulkPlan["moves"]; skipped?: BulkPlan["skipped"]; moved?: number };
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return { moves: json.moves ?? [], skipped: json.skipped ?? [], moved: json.moved ?? 0 };
  }

  // Every change is previewed first (a dry run - nothing is written) so the
  // HOD sees exactly who moves and who is skipped, and why, before confirming.
  async function previewBulk(mode: BulkMode, sectionId: string) {
    if (mode === "move" && !sectionId) { setBulkPlan(null); return; }
    setIsPreviewing(true);
    setBulkPlan(null);
    try {
      const plan = await requestBulk(mode === "unassign" ? { unassign: true, dryRun: true } : { targetSectionId: sectionId, dryRun: true });
      setBulkPlan(plan);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to preview" });
    } finally {
      setIsPreviewing(false);
    }
  }

  function openBulk(mode: BulkMode) {
    setBulkMode(mode);
    setBulkSectionId("");
    setBulkPlan(null);
    if (mode === "unassign") void previewBulk("unassign", "");
  }

  function closeBulk() {
    setBulkMode(null);
    setBulkSectionId("");
    setBulkPlan(null);
  }

  async function applyBulk() {
    if (!bulkMode || !bulkPlan || bulkPlan.moves.length === 0) return;
    setIsBulkApplying(true);
    try {
      const result = await requestBulk(bulkMode === "unassign" ? { unassign: true } : { targetSectionId: bulkSectionId });
      const sectionName = bulkTargetSections.find((s) => s.id === bulkSectionId)?.name;
      toast({
        variant: "success",
        title: bulkMode === "unassign"
          ? `Unassigned ${result.moved} student${result.moved === 1 ? "" : "s"}`
          : `Moved ${result.moved} student${result.moved === 1 ? "" : "s"} to Section ${sectionName ?? ""}`.trim(),
        description: result.skipped.length > 0 ? `${result.skipped.length} skipped - left as they were.` : undefined,
      });
      setSelectedIds(new Set());
      closeBulk();
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to move students" });
    } finally {
      setIsBulkApplying(false);
    }
  }

  // Existing lab-batch labels already in use in this student's own section -
  // offered as datalist suggestions so a second student gets typed in as
  // exactly "Batch 1" again rather than a near-miss ("batch1", "Batch  1")
  // that would silently exclude them from that batch's attendance roster
  // (labBatch match is case/whitespace-insensitive, but only once it's an
  // exact word-for-word match otherwise - see sectionRoster.ts).
  const editLabBatchSuggestions = useMemo(() => {
    if (!editTarget) return [];
    const labels = students
      .filter((s) => s.department === editTarget.department && s.section === editTarget.section && s.year === editTarget.year)
      .map((s) => (s.labBatch as string | undefined)?.trim())
      .filter((v): v is string => !!v);
    return Array.from(new Set(labels)).sort();
  }, [editTarget, students]);

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
    setEditLabBatch((student.labBatch as string | undefined) ?? "");
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
        body: JSON.stringify({ rollNumber: editRoll.trim(), status: editStatus, labBatch: editLabBatch.trim() }),
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
      const json = await res.json() as {
        error?: string;
        moved?: number;
        sections?: { sectionName: string; studentCount: number }[];
        invalidStudents?: { id: string; name?: string }[];
      };
      if (!res.ok) {
        if (res.status === 409) throw new Error(json.error ?? "Another distribution is already running for this department - try again shortly");
        if (json.invalidStudents?.length) {
          throw new Error(
            `${json.invalidStudents.length} student(s) have a missing/blank name - fix them before distributing: ${
              json.invalidStudents.map((s) => s.name || s.id).join(", ")
            }`
          );
        }
        throw new Error(json.error ?? "Failed to distribute");
      }
      const summary = (json.sections ?? []).map((s) => `${s.sectionName}: ${s.studentCount}`).join(", ");
      toast({ variant: "success", title: `Distributed ${json.moved} students`, description: summary });
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

  const allInViewSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const someInViewSelected = filtered.some((s) => selectedIds.has(s.id)) && !allInViewSelected;

  const columns: Column<StudentRow>[] = [
    {
      key: "select",
      excludeFromCsv: true,
      className: "w-10",
      header: (
        <Checkbox
          checked={allInViewSelected ? true : someInViewSelected ? "indeterminate" : false}
          onCheckedChange={(checked) => setAllSelected(filtered, checked === true)}
          aria-label="Select all students in view"
          className={SELECT_CHECKBOX_CLASS}
        />
      ),
      // The row itself navigates on click - keep the tick from doing that too.
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedIds.has(r.id)}
            onCheckedChange={(checked) => toggleSelected(r.id, checked === true)}
            aria-label={`Select ${r.name}`}
            className={SELECT_CHECKBOX_CLASS}
          />
        </div>
      ),
    },
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
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>{r.status}</Badge>,
    },
    {
      key: "labBatch",
      header: "Lab Batch",
      hideOnMobile: true,
      // Which split-lab sub-group this student sits in (see
      // StudentRecord.labBatch's own doc-comment) - blank until the HOD
      // manually assigns one via the row's Edit action.
      render: (r) => r.labBatch
        ? <span className="text-sm text-muted-foreground">{r.labBatch}</span>
        : <span className="text-sm text-muted-foreground/40">—</span>,
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
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Set roll number / status / lab batch">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // Same header - title, description and tab strip - for both views, so
  // switching tabs moves and resizes nothing; only the active pill changes.
  const studentsHeader = (
    <PageHeader
      title="Students"
      description="Your department's students, plus every branch grouped under it."
      actions={<StudentsViewTabs tabs={HOD_VIEWS} value={view} onChange={setView} />}
    />
  );

  if (view === "strength") {
    return (
      <div className="space-y-6">
        {studentsHeader}
        <StudentStrengthDashboard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {studentsHeader}

      {/* Distribute lives in the body, not the header, so the header above is
          identical to the Strength view's. */}
        {!isFreshmanView && (
        <div className="flex justify-end">
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
                Every student in the sections you pick - unassigned plus already-sectioned - is sorted by
                surname (first word of their name) and split evenly across those sections, earliest surnames
                first. Re-running this can move a student who was already in one of the picked sections to
                another, so the whole group stays in surname order as new students are imported later.
                Sections you don&apos;t pick, and roll numbers, are left untouched.
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
        </div>
        )}

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

      {!isFreshmanView && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3" data-testid="bulk-action-bar">
          {selectedStudents.length > 0 ? (
            <>
              <span className="text-sm font-medium">{selectedStudents.length} selected</span>
              <span className="text-xs text-muted-foreground">{selectedFromSummary}</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => openBulk("move")}>
                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />Move / Assign to section
                </Button>
                {selectedPlacedCount > 0 && (
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => openBulk("unassign")}>
                    Unassign
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                Tick students below to move or assign several to a section at once.
              </span>
              {unassignedInView.length > 0 && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAllSelected(unassignedInView, true)}>
                  Select all {unassignedInView.length} unassigned
                </Button>
              )}
            </>
          )}
          <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 mt-1">
            <span className="text-xs text-muted-foreground shrink-0">Select by roll no. range:</span>
            <Input
              placeholder="From roll no."
              value={rollFrom}
              onChange={(e) => setRollFrom(e.target.value)}
              className="h-8 w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              placeholder="To roll no."
              value={rollTo}
              onChange={(e) => setRollTo(e.target.value)}
              className="h-8 w-36"
            />
            <Button size="sm" variant="outline" disabled={!rollFrom.trim() || !rollTo.trim()} onClick={selectRollRange}>
              Select Range
            </Button>
          </div>
        </div>
      )}

      <DataTable
        data={isFreshmanView ? incomingFiltered : filtered}
        columns={isFreshmanView ? columns.filter((c) => c.key !== "actions" && c.key !== "select") : columns}
        onRowClick={(r) => router.push(`/hod/students/${r.id}`)}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        paginate
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
              <p className="text-xs text-muted-foreground">The student&apos;s unique roll number - it can be corrected, but must not be used by any other student.</p>
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
            <div className="space-y-2">
              <Label htmlFor="edit-lab-batch">Lab Batch</Label>
              <Input
                id="edit-lab-batch"
                list="edit-lab-batch-suggestions"
                value={editLabBatch}
                onChange={(e) => setEditLabBatch(e.target.value)}
                placeholder="e.g. Batch 1"
                autoComplete="off"
              />
              <datalist id="edit-lab-batch-suggestions">
                {editLabBatchSuggestions.map((label) => <option key={label} value={label} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Which split-lab sub-group this student sits in for a PRACTICAL subject - must match the batch
                label on the Timetable exactly. Leave blank if this section&rsquo;s labs aren&rsquo;t split.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMode !== null} onOpenChange={(open) => { if (!open && !isBulkApplying) closeBulk(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {bulkMode === "unassign"
                ? `Unassign ${selectedStudents.length} student${selectedStudents.length === 1 ? "" : "s"}`
                : `Move / Assign ${selectedStudents.length} student${selectedStudents.length === 1 ? "" : "s"}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Currently: {selectedFromSummary || "—"}</p>

            {bulkMode === "move" && (
              <div className="space-y-2">
                <Label>Move to section</Label>
                <Select
                  value={bulkSectionId}
                  onValueChange={(v) => { setBulkSectionId(v); void previewBulk("move", v); }}
                  disabled={bulkTargetSections.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                  <SelectContent>
                    {bulkTargetSections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {(bulkSectionLabels.get(s.id) ?? s.name)} · {s.studentCount ?? 0} student{(s.studentCount ?? 0) === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedYears.length > 1 ? (
                  <p className="text-xs text-amber-600">
                    The selected students are from different years. Filter by Year so every selected student is in the same year, then try again.
                  </p>
                ) : bulkTargetSections.length === 0 ? (
                  <p className="text-xs text-amber-600">
                    No section can take all of the selected students - they may belong to different branches, or no section exists yet for them. Select students of one branch, or create the section first.
                  </p>
                ) : null}
              </div>
            )}

            {isPreviewing && <p className="text-sm text-muted-foreground">Checking…</p>}

            {bulkPlan && (
              <div className="space-y-3" data-testid="bulk-preview">
                <p className="text-sm">
                  <strong>{bulkPlan.moves.length}</strong> will be {bulkMode === "unassign" ? "unassigned" : "moved"}
                  {bulkPlan.skipped.length > 0 && <> · <strong className="text-amber-600">{bulkPlan.skipped.length}</strong> skipped</>}
                </p>
                {bulkPlan.moves.length > 0 && (
                  <div className="max-h-44 overflow-y-auto rounded-md border divide-y text-sm">
                    {bulkPlan.moves.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="truncate"><span className="font-mono text-xs text-muted-foreground mr-2">{m.rollNumber || "—"}</span>{m.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{m.from || "Unassigned"} → {m.to || "Unassigned"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {bulkPlan.skipped.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-md border border-amber-200 bg-amber-50/50 divide-y divide-amber-100 text-sm">
                    {bulkPlan.skipped.map((s) => (
                      <div key={s.id} className="px-3 py-1.5">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground"> — {s.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                {bulkPlan.skipped.length > 0 && bulkPlan.moves.length > 0 && (
                  <p className="text-xs text-muted-foreground">Skipped students are left exactly as they are.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeBulk} disabled={isBulkApplying}>Cancel</Button>
            <Button
              onClick={() => void applyBulk()}
              loading={isBulkApplying}
              disabled={isPreviewing || !bulkPlan || bulkPlan.moves.length === 0}
              variant={bulkMode === "unassign" ? "destructive" : "default"}
            >
              {bulkMode === "unassign" ? "Unassign" : "Move"}{bulkPlan && bulkPlan.moves.length > 0 ? ` ${bulkPlan.moves.length}` : ""}
            </Button>
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
