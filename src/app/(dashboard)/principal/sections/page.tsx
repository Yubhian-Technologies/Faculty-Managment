"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookMarked, GraduationCap, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// College-wide Sections, for Principal / Vice Principal / College Admin -
// presented exactly like the HOD's own page (same year colours, grouping and
// per-group counts) but across every department rather than one.
//
// Read-only by necessity, not by preference: creating, editing and deleting a
// section are all HOD/Super Admin on the server (see api/college/sections),
// so an Add or Edit control here would only ever produce a 403.
//
// The sections API already returns the whole college for these roles - its
// department scoping applies to an HOD only - so every filter below works in
// memory over a single fetch.
export default function PrincipalSectionsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [courseKey, setCourseKey] = useState(ALL);
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL>(ALL);

  useEffect(() => {
    void (async () => {
      try {
        const [secRes, courseRes] = await Promise.all([
          fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections?: Section[] }>),
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
        ]);
        setSections(secRes.sections ?? []);
        setCourses(courseRes.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // One chip per programme, not one per department's own Course doc - the
  // same collapse the HOD page makes, or "Bachelor of Technology" appears
  // once for every department that offers it.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const courseIdsByKey = useMemo(
    () => new Map(courseGroups.map((g) => [g.key, new Set(g.courseIds)])),
    [courseGroups]
  );

  const byCourse = useMemo(
    () => (courseKey === ALL
      ? sections
      : sections.filter((s) => courseIdsByKey.get(courseKey)?.has(s.courseId) ?? false)),
    [sections, courseKey, courseIdsByKey]
  );

  // Each chip row is built from what the rows BEFORE it already narrowed to,
  // so a chip never offers a combination that yields nothing.
  const deptOptions = useMemo(
    () => Array.from(new Set(byCourse.map((s) => s.department).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [byCourse]
  );
  const byDept = useMemo(
    () => (deptFilter === ALL ? byCourse : byCourse.filter((s) => s.department === deptFilter)),
    [byCourse, deptFilter]
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(byDept.map((s) => s.year))).sort((a, b) => a - b),
    [byDept]
  );
  const visible = useMemo(
    () => (yearFilter === ALL ? byDept : byDept.filter((s) => s.year === yearFilter)),
    [byDept, yearFilter]
  );

  // Grouped by course + year, the same shape the HOD page renders.
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections"
        description="Every section in the college - open one to see its students"
      />

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
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

          <div className="flex gap-2 flex-wrap">
            <Chip active={courseKey === ALL} onClick={() => { setCourseKey(ALL); setDeptFilter(ALL); setYearFilter(ALL); }}>
              All Courses
            </Chip>
            {courseGroups.map((g) => (
              <Chip
                key={g.key}
                active={courseKey === g.key}
                onClick={() => { setCourseKey(g.key); setDeptFilter(ALL); setYearFilter(ALL); }}
              >
                {g.name}
              </Chip>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Chip active={deptFilter === ALL} onClick={() => { setDeptFilter(ALL); setYearFilter(ALL); }}>
              All Departments
            </Chip>
            {deptOptions.map((d) => (
              <Chip key={d} active={deptFilter === d} onClick={() => { setDeptFilter(d); setYearFilter(ALL); }}>
                {d}
              </Chip>
            ))}
          </div>

          {yearOptions.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <Chip active={yearFilter === ALL} onClick={() => setYearFilter(ALL)}>All Years</Chip>
              {yearOptions.map((y) => (
                <Chip key={y} active={yearFilter === y} onClick={() => setYearFilter(y)}>{ordinalYear(y)}</Chip>
              ))}
            </div>
          )}

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
                        <Link
                          key={sec.id}
                          href={`/principal/sections/${sec.id}`}
                          className={`rounded-xl border-2 p-5 flex flex-col gap-3 transition-shadow hover:shadow-md ${yearColor(sec.year)}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-2xl font-bold tracking-tight">{sec.name}</p>
                            {sec.department && <Badge variant="secondary" className="text-xs">{sec.department}</Badge>}
                          </div>

                          <p className="text-sm opacity-80">
                            {sec.batch}
                            {sec.regulation && <span> · {sec.regulation}</span>}
                            {/* The branch a shared-first-year section feeds -
                                stored plural for legacy shape, but a section
                                commits to exactly one. */}
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
                        </Link>
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
