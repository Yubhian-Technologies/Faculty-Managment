"use client";

import { useEffect, useMemo, useState } from "react";
import { BookMarked, GraduationCap, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { SectionRoster } from "@/components/academics/SectionRoster";
import type { Course, Section } from "@/types";

// Same palettes, ratio and grouping the HOD's own Sections page uses, so a
// section reads identically whichever dashboard it is seen from.
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
const STUDENT_FACULTY_RATIO = 15;
const ALL = "all";

// One section tile - shared by the Sections toggle and the Departments drill-down.
export function SectionCard({ sec, onOpen }: { sec: Section; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded-xl border-2 p-5 flex text-left flex-col gap-3 transition-shadow hover:shadow-md ${yearColor(sec.year)}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-2xl font-bold tracking-tight">{sec.name}</p>
      </div>
      <p className="text-sm opacity-80">
        {sec.batch}
        {sec.regulation && <span> · {sec.regulation}</span>}
        {/* The branch a shared-first-year section feeds - stored plural for legacy shape, but a section commits to exactly one. */}
        {!!sec.secondaryDepartments?.length && <span> · → {sec.secondaryDepartments[0]}</span>}
      </p>
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 opacity-50 shrink-0" />
        <span className="text-sm">
          {sec.facultyInchargeName
            ? <strong>{sec.facultyInchargeName}</strong>
            : <span className="opacity-50 italic">No incharge assigned</span>}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 opacity-50 shrink-0" />
        <span className="text-sm"><strong>{sec.studentCount ?? 0}</strong> students</span>
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
    </button>
  );
}

// College-wide Sections, for Principal / Vice Principal / College Admin.
// Read-only by necessity: sections are HOD/Super Admin writes on the server.
// Data loads on explicit "Load" button click - filter options are populated on mount.
export function SectionsPanel() {
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; isActive?: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [courseKey, setCourseKey] = useState(ALL);
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL>(ALL);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [courseRes, deptRes] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: { id: string; name: string; isActive?: boolean }[] }>),
        ]);
        setCourses(courseRes.courses ?? []);
        setDepartments(deptRes.departments ?? []);
      } catch {
        // silent
      }
    })();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const secRes = await fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections?: Section[] }>);
      setSections(secRes.sections ?? []);
      setHasLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoading(false);
    }
  }

  // One group per programme name, not per department's Course doc.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const courseIdsByKey = useMemo(
    () => new Map(courseGroups.map((g) => [g.key, new Set(g.courseIds)])),
    [courseGroups]
  );

  const byCourse = useMemo(
    () => (courseKey === ALL ? sections : sections.filter((s) => courseIdsByKey.get(courseKey)?.has(s.courseId) ?? false)),
    [sections, courseKey, courseIdsByKey]
  );
  // Derived from sections when loaded, or college departments when awaiting load.
  const deptOptions = useMemo(() => {
    if (sections.length > 0) {
      return Array.from(new Set(byCourse.map((s) => s.department).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    }
    return departments.filter((d) => d.isActive !== false).map((d) => d.name).sort((a, b) => a.localeCompare(b));
  }, [sections, byCourse, departments]);

  const byDept = useMemo(
    () => (deptFilter === ALL ? byCourse : byCourse.filter((s) => s.department === deptFilter)),
    [byCourse, deptFilter]
  );
  const yearOptions = useMemo(() => {
    if (sections.length > 0) {
      return Array.from(new Set(byDept.map((s) => s.year))).sort((a, b) => a - b);
    }
    return [1, 2, 3, 4];
  }, [sections, byDept]);

  const visible = useMemo(
    () => (yearFilter === ALL ? byDept : byDept.filter((s) => s.year === yearFilter)),
    [byDept, yearFilter]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; courseName: string; year: number; sections: Section[] }>();
    for (const s of visible) {
      const g = courseGroups.find((cg) => cg.courseIds.includes(s.courseId));
      const key = `${g?.key ?? s.courseId}_${s.year}`;
      if (!map.has(key)) {
        map.set(key, { key: g?.key ?? s.courseId, courseName: g?.name ?? s.courseName ?? "Course", year: s.year, sections: [] });
      }
      map.get(key)!.sections.push(s);
    }
    for (const g of map.values()) {
      g.sections.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    }
    return Array.from(map.values()).sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year);
  }, [visible, courseGroups]);

  const totalStudents = visible.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);
  const facultyNeeded = totalStudents > 0 ? Math.ceil(totalStudents / STUDENT_FACULTY_RATIO) : 0;

  if (openSectionId) {
    return <SectionRoster sectionId={openSectionId} onBack={() => setOpenSectionId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sections" description="Every section in the college - open one to see its students" />

      {/* ── Single-line filter bar with Load-on-demand ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-col gap-1 min-w-[160px] flex-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Course</label>
          <select
            value={courseKey}
            onChange={(e) => { setCourseKey(e.target.value); setDeptFilter(ALL); setYearFilter(ALL); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          >
            <option value={ALL}>All Courses</option>
            {courseGroups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[160px] flex-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Department</label>
          <select
            value={deptFilter}
            onChange={(e) => { setDeptFilter(e.target.value); setYearFilter(ALL); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          >
            <option value={ALL}>All Departments</option>
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Year</label>
          <select
            value={yearFilter === ALL ? ALL : String(yearFilter)}
            onChange={(e) => setYearFilter(e.target.value === ALL ? ALL : Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          >
            <option value={ALL}>All Years</option>
            {yearOptions.map((y) => <option key={y} value={String(y)}>{ordinalYear(y)}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={isLoading}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          {isLoading ? "Loading…" : hasLoaded ? "Refresh" : "Load"}
        </button>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : !hasLoaded ? (
        <EmptyState
          icon={<BookMarked className="h-10 w-10 text-muted-foreground" />}
          title="Click Load to view sections"
          description="Select your filters above, then click Load to fetch section data."
        />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<BookMarked className="h-10 w-10 text-muted-foreground" />}
          title="No sections yet"
          description="Sections are created by each department's HOD. None have been added in this college."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <BookMarked className="h-4 w-4" />
              <strong className="text-foreground">{visible.length}</strong> sections
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              <strong className="text-foreground">{totalStudents}</strong> students total
            </span>
            {facultyNeeded > 0 && (
              <span className="flex items-center gap-1.5">
                <UserRound className="h-4 w-4" />
                <strong className="text-foreground">{facultyNeeded}</strong> faculty needed
                <span className="text-xs opacity-70">(1:{STUDENT_FACULTY_RATIO} ratio)</span>
              </span>
            )}
          </div>
          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No sections match these filters.
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map((g) => {
                const sts = g.sections.reduce((s, r) => s + (r.studentCount ?? 0), 0);
                const req = sts > 0 ? Math.ceil(sts / STUDENT_FACULTY_RATIO) : 0;
                return (
                  <div key={`${g.key}_${g.year}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="font-semibold text-base">
                        {courseKey === ALL ? `${g.courseName} · ${ordinalYear(g.year)}` : ordinalYear(g.year)}
                      </h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${yearBadge(g.year)}`}>
                        {g.sections.length} section{g.sections.length !== 1 ? "s" : ""} · {sts} students
                        {req > 0 && <span className="ml-1 opacity-75">· {req} faculty needed</span>}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {g.sections.map((sec) => (
                        <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
