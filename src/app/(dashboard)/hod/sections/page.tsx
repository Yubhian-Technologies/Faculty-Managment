"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Pencil, Trash2, Plus, GraduationCap, UserCog, Eye } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import {
  resolveScopeDepartments, buildCourseGroups, managedBranchYearsMap, yearsInScope, managerEffectiveYears,
  mergeOwnDepartmentOptions, deriveHodScope,
} from "@/lib/departments/hodScope";
import type { SectionListItem, Course, Department } from "@/types";

type SectionRow = SectionListItem;

const YEAR_PALETTE = [
  "bg-purple-50 border-purple-200 text-purple-800",
  "bg-blue-50 border-blue-200 text-blue-800",
  "bg-emerald-50 border-emerald-200 text-emerald-800",
  "bg-amber-50 border-amber-200 text-amber-800",
  "bg-rose-50 border-rose-200 text-rose-800",
  "bg-cyan-50 border-cyan-200 text-cyan-800",
];
const YEAR_BADGE_PALETTE = [
  "bg-purple-100 text-purple-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function yearColor(year: number) { return YEAR_PALETTE[(year - 1) % YEAR_PALETTE.length]; }
function yearBadge(year: number) { return YEAR_BADGE_PALETTE[(year - 1) % YEAR_BADGE_PALETTE.length]; }
function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Pure, module-level (not a hook) so both deptOptions and yearTabOptions can
// call it directly instead of one depending on the other's memoized result -
// the real departments in scope, never a grouping container (sub-department
// or common parent) itself. See useCascadeFilter's comment for the two shapes.
const STUDENT_FACULTY_RATIO = 15;

export default function HODSectionsPage() {
  const router = useRouter();
  const myDepartments = useMyDepartments();
  // An HOD running two or more departments at once gets a flat list of every
  // owned department (+ their own sub-departments/managed branches) instead
  // of the two-tier Sub-Department -> Branch cascade below, which is a
  // single-root-at-a-time shape - see mergeOwnDepartmentOptions.
  const isMultiDept = myDepartments.length > 1;
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCourseKey, setActiveCourseKey] = useState<string>("all");
  const [activeYear, setActiveYear] = useState<number | "all">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  // Which sub-department's managed branches are currently drilled into (the
  // two-tier chip flow below) - null until one is picked.
  const [subDeptFilter, setSubDeptFilter] = useState<string | null>(null);
  // Which of THIS HOD's own top-level departments (primary or secondary -
  // myDepartments) is currently focused, for the multi-department "Your
  // Departments" chip row below - null shows every owned department combined.
  const [ownedDeptFilter, setOwnedDeptFilter] = useState<string | null>(null);
  // Which cross-listed branch (Section.secondaryDepartments) is focused, for
  // the "Branches" chip row below - null shows every branch this department
  // feeds combined. Distinct from deptFilter/subDeptFilter above: those narrow
  // by a section's OWNING department (s.department, e.g. "Physics" itself for
  // every section here), while this narrows by which real branch a shared-year
  // section feeds into (s.secondaryDepartments) - the dimension a department
  // like Physics that cross-lists directly (no sub-department layer, so
  // useCascadeFilter never applies) has no other way to filter by at all.
  const [secondaryDeptFilter, setSecondaryDeptFilter] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SectionRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sectionsRes, coursesRes, deptsRes] = await Promise.all([
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      ]);
      setSections(sectionsRes.sections ?? []);
      setCourses((coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      setDepartments(deptsRes.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Invoked through an async wrapper so the loader's setState calls aren't
  // reachable synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  // Own department + its sub-departments - the branches this (sub-)HOD manages.
  // For a multi-department HOD this is their FIRST department only - the
  // two-tier cascade below is single-root, and is disabled entirely for them
  // (isGroupingContainer/useCascadeFilter both forced off below); deptOptions
  // is what actually drives their (flat) filter tabs in that case.
  const ownDept = useMemo(() => departments.find((d) => d.name === myDepartments[0]) ?? null, [departments, myDepartments]);
  // A grouping container (e.g. "BS-Maths" grouping IT + CSE under a Sub-HOD) is
  // not a real department, so it's never a section's owner.
  const isGroupingContainer = !isMultiDept && (ownDept?.managedDepartments?.length ?? 0) > 0;
  // Own department's sub-departments, split into the ones that group real
  // branches (BS-Maths managing IT/CSBS) and plain ones that don't.
  const groupingChildren = useMemo(
    () => (ownDept ? departments.filter((d) => d.parentDepartmentId === ownDept.id && (d.managedDepartments?.length ?? 0) > 0) : []),
    [departments, ownDept]
  );
  const plainChildren = useMemo(
    () => (ownDept ? departments.filter((d) => d.parentDepartmentId === ownDept.id && (d.managedDepartments?.length ?? 0) === 0) : []),
    [departments, ownDept]
  );
  // Main/common HOD case (e.g. "Basic Science"): their own department isn't a
  // grouping container itself, but has sub-departments and at least one of
  // them groups real branches - so browsing goes Sub-Department -> Department
  // instead of a flat list, and neither the common department nor its
  // sub-departments (both mere containers) are ever offered as a filter target.
  const useCascadeFilter = !isMultiDept && !isGroupingContainer && Boolean(ownDept?.hasSubDepartments) && groupingChildren.length > 0;

  // Real departments this (sub-)HOD manages, feeding the branch filter tabs -
  // never a grouping container (sub-department or common parent) itself. A
  // multi-department HOD gets the union of every owned department's own scope
  // instead (flat, no cascade - see mergeOwnDepartmentOptions).
  const deptOptions = useMemo(
    () => (isMultiDept
      ? mergeOwnDepartmentOptions(departments, myDepartments)
      : resolveScopeDepartments(ownDept, departments, isGroupingContainer, useCascadeFilter, groupingChildren, plainChildren)),
    [isMultiDept, myDepartments, departments, ownDept, isGroupingContainer, useCascadeFilter, groupingChildren, plainChildren]
  );

  // Each of THIS HOD's own top-level departments (myDepartments - the first is
  // "Primary", any rest "Secondary"), resolved to its FULL real scope (itself
  // plus its own sub-departments/managed branches, via deriveHodScope) - not
  // just an exact name match, since a department with sub-departments never
  // owns sections directly itself (see resolveScopeDepartments). Powers the
  // "Your Departments" chip row: a plain name-match filter would show zero
  // sections for a secondary department that groups branches, which is
  // exactly the confusion this row exists to clear up.
  const ownedDeptScopes = useMemo(
    () => (isMultiDept
      ? myDepartments.map((name) => ({ name, realNames: new Set(deriveHodScope(departments, name).deptOptions.map((d) => d.name)) }))
      : []),
    [isMultiDept, myDepartments, departments]
  );
  const activeOwnedScope = useMemo(
    () => (ownedDeptFilter ? ownedDeptScopes.find((s) => s.name === ownedDeptFilter) ?? null : null),
    [ownedDeptFilter, ownedDeptScopes]
  );
  // Clicking a department in that row jumps straight to ALL of its sections -
  // clearing the branch/course/year filters below rather than leaving some of
  // them stuck on a value that belonged to whatever was selected before.
  function selectOwnedDept(name: string | null) {
    setOwnedDeptFilter(name);
    setDeptFilter("all");
    setSubDeptFilter(null);
    setSecondaryDeptFilter(null);
    setActiveCourseKey("all");
    setActiveYear("all");
  }

  // The department/branch filter tabs - the real departments this (sub-)HOD
  // manages (never a grouping container), union-ed with any real department
  // already present on a loaded section so none is unreachable by a tab.
  // Narrowed to the focused owned department's own branches (ownedDeptFilter)
  // when one is picked from the "Your Departments" row above, so the two rows
  // read as a Department -> Branch drill-down for a multi-department HOD.
  const scopeDepartments = useMemo(() => {
    const names = new Set(deptOptions.map((d) => d.name));
    for (const s of sections) if (s.department && s.department !== ownDept?.name) names.add(s.department);
    let list = Array.from(names).filter(Boolean).sort();
    if (activeOwnedScope) list = list.filter((n) => activeOwnedScope.realNames.has(n));
    return list;
  }, [deptOptions, sections, ownDept, activeOwnedScope]);

  // A sub-department never owns a course of its own (it shares its parent's),
  // so `load()`'s default own-scope course fetch resolves to either ownDept
  // (plain HOD) or ownDept's parent (sub-HOD) - it never reaches a MANAGED
  // branch's own Course doc (e.g. IT's own "Bachelor of Technology"). Whenever
  // deptOptions includes something beyond ownDept itself, fetch each of those
  // departments' courses explicitly and merge them in, so the course tabs and
  // Add Section's course list both cover every real branch in scope.
  const needsExtraCourseFetch = deptOptions.some((d) => d.id !== ownDept?.id);
  useEffect(() => {
    if (!needsExtraCourseFetch) return;
    let cancelled = false;
    void (async () => {
      try {
        const lists = await Promise.all(
          deptOptions.map((d) =>
            fetch(`/api/college/courses?departmentId=${encodeURIComponent(d.id)}`)
              .then((r) => r.json() as Promise<{ courses: Course[] }>)
              .then((j) => j.courses ?? [])
          )
        );
        if (cancelled) return;
        setCourses((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          for (const list of lists) for (const c of list) byId.set(c.id, c);
          return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      } catch {
        // Non-fatal - the default own-scope fetch from load() already covers the common case.
      }
    })();
    return () => { cancelled = true; };
  }, [needsExtraCourseFetch, deptOptions]);

  // The HOD's Course list unions courses across every related department - a
  // department fed by another (e.g. CSE fed by Basic Science's shared first-year
  // course) surfaces the feeder's course alongside its own. Both instances carry
  // the SAME catalog course, so without collapsing they render as two identical
  // "Bachelor of Technology" tabs, each filtering only the sections that happen
  // to store that particular course-doc id - splitting one program in two.
  // Group by catalog course (falling back to the normalized name for legacy
  // courses created before the catalog existed) and remember every underlying
  // course-doc id so a single tab filters sections across all of them.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);

  const ownDeptIds = useMemo(
    () => new Set(myDepartments.map((n) => departments.find((d) => d.name === n)?.id).filter((id): id is string => !!id)),
    [myDepartments, departments]
  );

  function openCreate() {
    const group = activeCourseKey !== "all" ? courseGroups.find((g) => g.key === activeCourseKey) ?? null : null;
    if (!group) { router.push("/hod/sections/new"); return; }
    // Prefer one of this HOD's own department's instance of the course so a
    // created section's stored courseId lines up with their department
    // rather than a feeder's - both share the same catalog, so year options
    // are identical.
    const own = group.courseIds.find((id) => ownDeptIds.has(courses.find((c) => c.id === id)?.departmentId ?? ""));
    router.push(`/hod/sections/new?courseId=${own ?? group.courseIds[0]}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/sections/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to delete" });
        return;
      }
      toast({ variant: "success", title: `Section ${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  const activeGroup = activeCourseKey !== "all" ? courseGroups.find((g) => g.key === activeCourseKey) ?? null : null;
  const activeCourseIds = activeGroup ? new Set(activeGroup.courseIds) : null;

  // Whether THIS (sub-)HOD actually views branches through a managed
  // relationship - as the main common HOD via the cascade, or as a sub-HOD who
  // IS the grouping container. A plain HOD (e.g. CSE's own dedicated HOD) is
  // neither, even when CSE happens to be managed by some sub-department
  // elsewhere for a shared year - that shared year is never theirs to see, so
  // a managed branch's years must never apply to their own department for them.
  const viewsManagedBranchYears = useCascadeFilter || isGroupingContainer;

  // Year filter tabs follow the department's assigned years ("Years Taught"),
  // not the raw course span - so a department teaching [1,2,3] shows only those,
  // mirroring what the Add Section dropdown now offers. When a specific branch
  // tab is active, use that branch's assigned years (unioned with its managing
  // sub-department's, for a managed branch); otherwise union every department
  // in this (sub-)HOD's scope. Falls back to the full course span when nothing
  // is assigned yet.
  // Read straight off courseGroups/activeCourseKey (both provably stable -
  // courseGroups is itself memoized, activeCourseKey a plain string) rather
  // than off activeGroup: the React Compiler can't see inside
  // buildCourseGroups to prove the group object is never mutated afterwards,
  // and bails out of optimizing the whole component when a memo depends on
  // something it can't rule that out for.
  const activeDurationYears = useMemo(
    () => (activeCourseKey !== "all" ? courseGroups.find((g) => g.key === activeCourseKey)?.durationYears ?? 0 : 0),
    [courseGroups, activeCourseKey]
  );
  // Only a real catalog course (not a legacy, pre-catalog one - see
  // CourseGroup) can have a per-course academic-structure override; a legacy
  // group falls back to each department's flat fields, same as always.
  const activeCatalogId = useMemo(
    () => (activeCourseKey !== "all" ? courseGroups.find((g) => g.key === activeCourseKey)?.catalogId : undefined),
    [courseGroups, activeCourseKey]
  );
  const yearTabOptions = useMemo(() => {
    if (!activeDurationYears) return [] as number[];
    const courseYears = Array.from({ length: activeDurationYears }, (_, i) => i + 1);
    // Recomputed per active course - cheap enough (a college's department
    // count is small) to compute inline rather than its own memo.
    const managedBranchYearsForActiveCourse = managedBranchYearsMap(departments, activeCatalogId);

    if (deptFilter !== "all") {
      // A specific branch is the active filter - its own years for this
      // course, plus whatever shared year its manager contributes.
      const relevant = departments.filter((d) => d.name === deptFilter);
      return yearsInScope(activeDurationYears, relevant, managedBranchYearsForActiveCourse, viewsManagedBranchYears, activeCatalogId, departments);
    }

    if (viewsManagedBranchYears) {
      // Nothing (or only a sub-department) picked yet - covers BOTH shapes
      // that reach branches through a managed relationship: the main common
      // HOD browsing "All Departments" via the cascade (subDeptFilter may or
      // may not be set), and a sub-department's OWN HOD logged in directly
      // (isGroupingContainer - subDeptFilter is never set for them, so
      // `manager` resolves straight to their own department). Either way,
      // only the shared structure's own years for this course are "in view"
      // here. A managed branch's own later years (e.g. EEE's own years 2-4 of
      // a B.Tech Basic Science - English only shares year 1 of) belong to
      // that branch's own dedicated HOD, not to the manager, and only become
      // relevant once that specific branch is picked above (the deptFilter
      // branch below) - unioning every managed branch's own years in here is
      // exactly what let this page offer years the manager was never
      // assigned for a course.
      const manager = subDeptFilter ? groupingChildren.find((c) => c.name === subDeptFilter) : ownDept;
      if (!manager) return [];
      const managerYears = managerEffectiveYears(manager, departments, activeCatalogId);
      return managerYears.length > 0 ? courseYears.filter((y) => managerYears.includes(y)) : courseYears;
    }

    const relevant = resolveScopeDepartments(ownDept, departments, isGroupingContainer, useCascadeFilter, groupingChildren, plainChildren);
    return yearsInScope(activeDurationYears, relevant, managedBranchYearsForActiveCourse, viewsManagedBranchYears, activeCatalogId, departments);
  }, [
    activeDurationYears, activeCatalogId, deptFilter, departments, ownDept, useCascadeFilter, groupingChildren,
    plainChildren, isGroupingContainer, viewsManagedBranchYears, subDeptFilter,
  ]);

  // courseId -> catalogId, so each section (which only stores courseId) can be
  // resolved against its OWN course's per-course scope - a department's years
  // are decided per course (Department.courseScopes), so a section's
  // visibility must follow its own course's catalogId, not a single flat
  // per-department value (that was the bug: an M.Tech section in a department
  // whose OTHER course, e.g. B.Tech, has different years would be wrongly
  // hidden/shown based on the wrong course's years).
  const catalogIdByCourseId = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const c of courses) m.set(c.id, c.catalogId);
    return m;
  }, [courses]);

  const deptByName = useMemo(() => {
    const m = new Map<string, Department>();
    for (const d of departments) m.set(d.name, d);
    return m;
  }, [departments]);

  // Each section is scoped to the years its OWN department teaches THAT
  // section's own course (managerEffectiveYears - per-course override, falling
  // back to the department's legacy flat fields/parent chain). A section whose
  // year that course no longer covers (e.g. narrowed after the section was
  // created) drops out of the view, so the list tracks the Principal's year
  // selection. A department/course with nothing resolved yet is left
  // unrestricted. A managed branch also stays visible for any year its
  // managing sub-department teaches for that course, even though the branch's
  // own years don't include it - but only for a viewer who actually reaches it
  // that way (viewsManagedBranchYears); the branch's own dedicated HOD stays
  // strictly within its own resolved years.
  const yearScopedSections = useMemo(() => sections.filter((s) => {
    const dept = deptByName.get(s.department);
    const catalogId = catalogIdByCourseId.get(s.courseId);
    const assigned = dept ? managerEffectiveYears(dept, departments, catalogId) : [];
    if (assigned.length === 0 || assigned.includes(s.year)) return true;
    const branchYears = managedBranchYearsMap(departments, catalogId).get(s.department) ?? [];
    return viewsManagedBranchYears && branchYears.includes(s.year);
  }), [sections, deptByName, catalogIdByCourseId, departments, viewsManagedBranchYears]);

  // The course + owned-department scoped universe, BEFORE the branch filter
  // itself narrows it further - what the "Branches" row's own counts (and its
  // "All" chip) are computed against, so picking a branch never moves the
  // baseline the other chips report against.
  const courseAndOwnedScopedSections = useMemo(
    () => yearScopedSections.filter((s) => {
      if (activeOwnedScope && !activeOwnedScope.realNames.has(s.department)) return false;
      if (activeCourseIds && !activeCourseIds.has(s.courseId)) return false;
      return true;
    }),
    [yearScopedSections, activeOwnedScope, activeCourseIds]
  );
  // Every real branch a section in view feeds into (Section.secondaryDepartments,
  // 0 or 1 entries per section - see sectionLabel.ts), with a live count each -
  // e.g. Physics cross-listing straight to IT/ME with no sub-department layer,
  // where deptFilter/scopeDepartments can't tell those sections apart at all
  // since every one of them is owned by "Physics" itself. Empty (row hidden)
  // for a department that doesn't cross-list, unchanged from before this existed.
  const secondaryDeptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of courseAndOwnedScopedSections) {
      for (const n of s.secondaryDepartments ?? []) if (n) m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  }, [courseAndOwnedScopedSections]);
  const secondaryDeptOptions = useMemo(
    () => Array.from(secondaryDeptCounts.keys()).sort(),
    [secondaryDeptCounts]
  );

  // Live section count per owned department (Your Departments row) - counted
  // across that department's full scope (ownedDeptScopes), same year-scoped
  // universe as the summary strip above.
  const ownedDeptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const { name, realNames } of ownedDeptScopes) {
      m.set(name, yearScopedSections.filter((s) => realNames.has(s.department)).length);
    }
    return m;
  }, [ownedDeptScopes, yearScopedSections]);

  // Sub-department drill-down (only reachable when useCascadeFilter is active):
  // with a sub-department picked but no specific branch yet, show every section
  // across every branch it manages; once a branch chip is picked, deptFilter
  // narrows to that one branch same as the flat (non-cascading) case below.
  const subDeptBranchNames = useMemo(() => {
    if (!subDeptFilter) return null;
    const dept = groupingChildren.find((c) => c.name === subDeptFilter);
    return dept ? new Set(dept.managedDepartments ?? []) : new Set<string>();
  }, [subDeptFilter, groupingChildren]);

  const filteredSections = yearScopedSections.filter((s) => {
    if (activeOwnedScope && !activeOwnedScope.realNames.has(s.department)) return false;
    if (activeCourseIds && !activeCourseIds.has(s.courseId)) return false;
    if (secondaryDeptFilter && !(s.secondaryDepartments ?? []).includes(secondaryDeptFilter)) return false;
    if (activeGroup && activeYear !== "all" && s.year !== activeYear) return false;
    if (deptFilter !== "all") {
      if (s.department !== deptFilter) return false;
    } else if (subDeptBranchNames && !subDeptBranchNames.has(s.department)) {
      return false;
    }
    return true;
  });

  // Group by course, then by year within each course. Sections keyed by the
  // collapsed course group (not the raw course-doc id) so two instances of the
  // same catalog course - e.g. a feeder's and the fed department's "Bachelor of
  // Technology" - land in one group instead of two identically-labeled cards.
  const groupKeyByCourseId = new Map<string, string>();
  for (const cg of courseGroups) for (const id of cg.courseIds) groupKeyByCourseId.set(id, cg.key);
  type Group = { key: string; courseName: string; year: number; sections: SectionRow[] };
  const groups: Group[] = [];
  for (const s of filteredSections) {
    const gk = groupKeyByCourseId.get(s.courseId) ?? s.courseId;
    let g = groups.find((x) => x.key === gk && x.year === s.year);
    if (!g) {
      g = { key: gk, courseName: s.courseName ?? "Unknown Course", year: s.year, sections: [] };
      groups.push(g);
    }
    g.sections.push(s);
  }
  groups.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year);

  const totalStudents = yearScopedSections.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections"
        description="Manage class sections, assign faculty incharge, and track student count"
        actions={
          <Button onClick={openCreate} disabled={courses.length === 0}>
            <Plus className="h-4 w-4 mr-2" />Add Section
          </Button>
        }
      />

      {!isLoading && courses.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments before creating sections.
        </div>
      )}

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <GraduationCap className="h-4 w-4" />
          <span><strong className="text-foreground">{yearScopedSections.length}</strong> sections</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{totalStudents}</strong> students total</span>
        </div>
        {totalStudents > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <UserCog className="h-4 w-4" />
            <span>
              <strong className="text-foreground">{Math.ceil(totalStudents / STUDENT_FACULTY_RATIO)}</strong> faculty needed
              <span className="ml-1 text-xs">(1:{STUDENT_FACULTY_RATIO} ratio)</span>
            </span>
          </div>
        )}
      </div>

      {/* "Your Departments" row - only for an HOD heading more than one
          department at once. Every owned department (primary + secondary) gets
          its own chip with a live section count, so it's immediately obvious
          which departments/sections belong to this login. Clicking a chip jumps
          straight to ALL of that department's sections, clearing the branch/
          course/year filters below rather than leaving the view accidentally
          narrowed to whatever was picked before. */}
      {isMultiDept && (
        <div className="flex gap-2 flex-wrap items-center rounded-lg border bg-muted/20 p-3">
          <span className="text-xs font-medium text-muted-foreground mr-1">Your departments:</span>
          <button
            onClick={() => selectOwnedDept(null)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              ownedDeptFilter === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All departments · {yearScopedSections.length}
          </button>
          {myDepartments.map((name, idx) => (
            <button
              key={name}
              onClick={() => selectOwnedDept(name)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                ownedDeptFilter === name
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {name}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  ownedDeptFilter === name ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                }`}
              >
                {idx === 0 ? "Primary" : "Secondary"}
              </span>
              <span className="opacity-75">· {ownedDeptCounts.get(name) ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {/* Course filter tabs */}
      {courses.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setActiveCourseKey("all"); setActiveYear("all"); setSecondaryDeptFilter(null); }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              activeCourseKey === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All Courses
          </button>
          {courseGroups.map((g) => (
            <button
              key={g.key}
              onClick={() => { setActiveCourseKey(g.key); setActiveYear("all"); setSecondaryDeptFilter(null); }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeCourseKey === g.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* "Branches" row - only for a department that cross-lists sections
          straight to real branches (Section.secondaryDepartments), e.g.
          Physics feeding IT and ME with no sub-department layer between them.
          Every section here is owned by Physics itself (s.department), so the
          Department/branch tabs below can never tell them apart - this is the
          only place that filters by which branch a section actually feeds. */}
      {secondaryDeptOptions.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center rounded-lg border bg-muted/20 p-3">
          <span className="text-xs font-medium text-muted-foreground mr-1">Branches:</span>
          <button
            onClick={() => setSecondaryDeptFilter(null)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              secondaryDeptFilter === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All branches · {courseAndOwnedScopedSections.length}
          </button>
          {secondaryDeptOptions.map((name) => (
            <button
              key={name}
              onClick={() => setSecondaryDeptFilter(name)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                secondaryDeptFilter === name
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {name} · {secondaryDeptCounts.get(name) ?? 0}
            </button>
          ))}
        </div>
      )}

      {/* Department / branch filter tabs. Two shapes:
          - Main/common HOD (useCascadeFilter): Sub-Department chips only - never
            the common department or a sub-department itself, since neither owns
            sections directly. Picking a sub-department reveals a second row of
            just the real branches it manages (e.g. BS-Maths -> IT, CSBS).
          - Everyone else (plain HOD, or a Sub-HOD logged in directly): the
            existing flat row - own department plus every branch grouped under
            them, so a Sub-HOD can jump between the departments assigned to
            them (All, CSE, IT, ...). */}
      {useCascadeFilter ? (
        <>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { setSubDeptFilter(null); setDeptFilter("all"); }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                subDeptFilter === null && deptFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              All Departments
            </button>
            {plainChildren.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSubDeptFilter(null); setDeptFilter(c.name); }}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  deptFilter === c.name
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
            {groupingChildren.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSubDeptFilter(c.name); setDeptFilter("all"); }}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  subDeptFilter === c.name
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {subDeptFilter && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setDeptFilter("all")}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  deptFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                All {subDeptFilter}
              </button>
              {Array.from(subDeptBranchNames ?? []).sort().map((name) => (
                <button
                  key={name}
                  onClick={() => setDeptFilter(name)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    deptFilter === name
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        scopeDepartments.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setDeptFilter("all")}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                deptFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              All Departments
            </button>
            {scopeDepartments.map((d) => (
              <button
                key={d}
                onClick={() => setDeptFilter(d)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  deptFilter === d
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )
      )}

      {/* Year filter tabs (only when a specific course is selected) */}
      {activeGroup && (
        <div className="flex gap-2 flex-wrap">
          {(["all", ...yearTabOptions] as (number | "all")[]).map((y) => (
            <button
              key={y}
              onClick={() => setActiveYear(y)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeYear === y
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {y === "all" ? "All Years" : ordinalYear(y)}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state - keyed off the year-scoped set so a department whose only
          sections fall outside its assigned years doesn't render a blank page. */}
      {!isLoading && courses.length > 0 && yearScopedSections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{sections.length === 0 ? "No sections yet" : "No sections for the assigned years"}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {sections.length === 0
              ? "Create your first section to get started"
              : "This department's sections fall outside its currently assigned years."}
          </p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Section</Button>
        </div>
      )}

      {/* Sections grouped by course + year */}
      {!isLoading && groups.length > 0 && (
        <div className="space-y-8">
          {groups.map((g) => {
            const sts = g.sections.reduce((s, r) => s + (r.studentCount ?? 0), 0);
            const req = sts > 0 ? Math.ceil(sts / STUDENT_FACULTY_RATIO) : 0;
            return (
              <div key={`${g.key}_${g.year}`}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-semibold text-base">
                    {activeCourseKey === "all" ? `${g.courseName} · ${ordinalYear(g.year)}` : ordinalYear(g.year)}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${yearBadge(g.year)}`}>
                    {g.sections.length} section{g.sections.length !== 1 ? "s" : ""} · {sts} students
                    {req > 0 && <span className="ml-1 opacity-75">· {req} faculty needed</span>}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.sections.map((sec) => (
                    <div
                      key={sec.id}
                      className={`rounded-xl border-2 p-5 flex flex-col gap-3 ${yearColor(sec.year)}`}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between">
                        <Link href={`/hod/sections/${sec.id}`} className="hover:underline">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-2xl font-bold tracking-tight">{sec.name}</p>
                            {/* The section's own department (branch) - always shown so a
                                Sub-HOD can tell which of their managed branches it belongs to. */}
                            {sec.department && (
                              <Badge variant="secondary" className="text-xs">{sec.department}</Badge>
                            )}
                            {sec.accessLevel === "secondary" && (
                              <Badge variant="secondary" className="text-xs">View only</Badge>
                            )}
                          </div>
                          <p className="text-sm opacity-70 mt-0.5">{sec.batch}</p>
                        </Link>
                        <div className="flex gap-1">
                          <button
                            onClick={() => router.push(`/hod/sections/${sec.id}`)}
                            className="p-1.5 rounded-md hover:bg-black/10 transition-colors"
                            title="View students"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {sec.accessLevel !== "secondary" && (
                            <>
                              <button
                                onClick={() => router.push(`/hod/sections/${sec.id}/edit`)}
                                className="p-1.5 rounded-md hover:bg-black/10 transition-colors"
                                title="Edit section"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(sec)}
                                className="p-1.5 rounded-md hover:bg-red-200/60 transition-colors text-red-700"
                                title="Delete section"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Faculty incharge */}
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          {sec.facultyInchargeName
                            ? <strong>{sec.facultyInchargeName}</strong>
                            : <span className="opacity-50 italic">No incharge assigned</span>
                          }
                        </span>
                      </div>

                      {/* Student intake + faculty ratio */}
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          <strong>{sec.studentCount ?? 0}</strong> students
                        </span>
                      </div>
                      {(sec.studentCount ?? 0) > 0 && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <GraduationCap className="h-4 w-4 opacity-50 shrink-0" />
                          <span className="text-sm">
                            <strong>{Math.ceil((sec.studentCount ?? 0) / STUDENT_FACULTY_RATIO)}</strong> faculty needed
                            <span className="text-[11px] opacity-60 ml-1">(1:{STUDENT_FACULTY_RATIO})</span>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete Section ${deleteTarget?.name ?? ""}?`}
        description={
          (deleteTarget?.studentCount ?? 0) > 0
            ? `This section has ${deleteTarget?.studentCount} student(s). Remove all students before deleting.`
            : `This will permanently delete Section ${deleteTarget?.name ?? ""} (${deleteTarget?.batch ?? ""}). This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
