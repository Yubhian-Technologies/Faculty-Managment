"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ClipboardList, GraduationCap, Search, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { buildCourseGroups, deriveHodScope, managerEffectiveYears } from "@/lib/departments/hodScope";
import { ordinalYear } from "@/lib/timetable/gridModel";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import type { Course, Department, Section } from "@/types";

// Reaching one section's timetable used to be four clicks: a course tile, then
// a year tile, then a section tile, then the grid - every level a page that
// re-fetched the level below it. This is the same journey as three filters and
// a Load button, so an HOD working through a department's sections switches
// between them by changing a Select instead of walking back up a page each time.
//
// The grid itself is unchanged - still TimetableGridEditor, the same component
// the drill-down's last step rendered, including all its publish/import/export
// actions. It is simply mounted only once Load is clicked, rather than on
// arrival, since it is a heavy fetch-and-render (timings + slots + draft +
// assignments for one section).

/** The section whose timetable is currently on screen. Null until Load. */
interface LoadedSection {
  // The SECTION's own courseId, never the filter's. A section in a shared
  // first year is filed under its real branch's own Course doc, so loading the
  // grid with the course picked in the filter would key its saved timetable to
  // the wrong Course doc entirely - same reason the drill-down's section tile
  // navigated with `s.courseId` (see its own comment there).
  courseId: string;
  year: string;
  sectionId: string;
}

function SectionTimetable() {
  const myDepartments = useMyDepartments();
  // Optional deep link (?courseId=&year=) - preselects the filters only; the
  // timetable still loads on the Load button.
  const searchParams = useSearchParams();
  const presetCourseId = searchParams.get("courseId");
  const presetYear = searchParams.get("year");
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [courseKey, setCourseKey] = useState("");
  const [year, setYear] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [loaded, setLoaded] = useState<LoadedSection | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([coursesRes, deptsRes]) => {
        const loadedCourses = (coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name));
        setCourses(loadedCourses);
        setDepartments(deptsRes.departments ?? []);
        if (presetCourseId) {
          const group = buildCourseGroups(loadedCourses).find((g) => g.courseIds.includes(presetCourseId));
          if (group) {
            setCourseKey(group.key);
            if (presetYear) setYear(presetYear);
          }
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collapse the several Course docs that represent one catalog programme into
  // a single choice - same grouping Sections uses (buildCourseGroups).
  // Without this, a shared-first-year manager (Basic Science) saw its own
  // "Bachelor of Technology" AND each managed branch's own doc for the same
  // programme as separate, confusingly-identical options - only the manager's
  // own doc actually resolves any years/sections for THIS viewer.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  // This HOD's own top-level department ids (never a managed branch) - used to
  // prefer a group's OWN doc over a sibling branch's, same preference
  // hod/sections/page.tsx's openCreate() already applies.
  const ownDeptIds = useMemo(
    () => new Set(myDepartments.map((n) => departments.find((d) => d.name === n)?.id).filter((id): id is string => !!id)),
    [myDepartments, departments]
  );
  // A legacy (pre-catalog) course has no catalogId, so buildCourseGroups falls
  // back to grouping by normalized name - two departments could coincidentally
  // share a name without any real relationship, so the department suffix stays
  // for that ambiguous case only.
  const groupNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of courseGroups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
    return counts;
  }, [courseGroups]);

  // The one concrete Course doc behind the picked group - the year resolution
  // below needs its departmentId/catalogId, and the sections query needs the
  // whole group.
  const selectedGroup = useMemo(() => courseGroups.find((g) => g.key === courseKey) ?? null, [courseGroups, courseKey]);
  const selectedCourse = useMemo(() => {
    if (!selectedGroup) return null;
    const own = selectedGroup.courseIds.find((id) => ownDeptIds.has(courses.find((c) => c.id === id)?.departmentId ?? ""));
    return courses.find((c) => c.id === (own ?? selectedGroup.courseIds[0])) ?? null;
  }, [selectedGroup, courses, ownDeptIds]);

  // True if ANY of this HOD's own departments reaches branches through a
  // managed relationship (Basic Science's cascade, or a sub-HOD who IS the
  // grouping container) - decides which of the two year resolutions applies.
  const viewsManagedBranchYears = useMemo(
    () => myDepartments.some((name) => deriveHodScope(departments, name).viewsManagedBranchYears),
    [myDepartments, departments]
  );
  // This HOD's own top-level department (their first, for the common
  // single-department case - see hod/sections/page.tsx's identical `ownDept`).
  const ownDept = useMemo(() => departments.find((d) => d.name === myDepartments[0]) ?? null, [departments, myDepartments]);

  // Identical to the year tiles the drill-down showed, so the filter offers
  // exactly the years that page would have.
  const years = useMemo(() => {
    if (!selectedCourse) return [];
    // A viewer who reaches branches through a managed relationship can only ever
    // BUILD a timetable for the shared year(s) THEY OWN - resolved from their
    // own department, never unioned with a sibling branch's own (unrelated)
    // later years. Mirrors hod/sections/page.tsx's "All Departments" aggregate
    // view, which resolves the exact same way.
    if (viewsManagedBranchYears) {
      if (!ownDept) return [];
      return managerEffectiveYears(ownDept, departments, selectedCourse.catalogId);
    }
    // Plain viewer: this course doc's own department's own effective years -
    // same helper, just pointed at the doc's own department instead.
    const dept = departments.find((d) => d.id === selectedCourse.departmentId);
    if (!dept) return [];
    return managerEffectiveYears(dept, departments, selectedCourse.catalogId);
  }, [selectedCourse, departments, ownDept, viewsManagedBranchYears]);

  // Sections for the picked course+year. Every Course doc for the same catalog
  // programme is queried, across departments - a shared-first-year section
  // (e.g. a managed branch's own Year-1 section, filed under that branch's OWN
  // Course doc) never carries the picked doc's id, so querying by it alone
  // silently returns nothing for it even though it's clearly the same
  // programme/year.
  useEffect(() => {
    // Sections are cleared by the filter handlers below, not here - a
    // setSections in this early return would be a setState reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    if (!selectedGroup || !selectedCourse || !year) return;
    let cancelled = false;
    // Wrapped so the loader's setState calls aren't reachable synchronously
    // from the effect body either - same pattern as hod/sections and
    // hod/settings/sub-departments.
    void (async () => {
      setIsLoadingSections(true);
      try {
        const res = await fetch(
          `/api/college/sections?courseId=${encodeURIComponent(selectedGroup.courseIds.join(","))}&year=${encodeURIComponent(year)}`
        );
        const d = (await res.json()) as { sections: Section[] };
        if (!cancelled) setSections((d.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        if (!cancelled) setIsLoadingSections(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGroup, selectedCourse, year]);

  // Changing a filter invalidates what's on screen: without this, switching
  // year would leave the previous year's timetable sitting below the filters
  // looking like it belonged to the new selection.
  function changeCourse(next: string) {
    setCourseKey(next);
    setYear("");
    setSectionId("");
    setSections([]);
    setLoaded(null);
  }
  function changeYear(next: string) {
    setYear(next);
    setSectionId("");
    setLoaded(null);
  }
  function changeSection(next: string) {
    setSectionId(next);
    setLoaded(null);
  }

  function handleLoad() {
    const section = sections.find((s) => s.id === sectionId);
    if (!selectedCourse || !year || !section) return;
    setLoaded({ courseId: section.courseId, year, sectionId: section.id });
  }

  const canLoad = !!selectedCourse && !!year && !!sectionId && !isLoadingSections;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Pick a course, year and section, then load that section's timetable to build or publish it"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find a section</CardTitle>
          <CardDescription>
            Each filter narrows the next one. Nothing loads until you press Load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-md border bg-muted/30 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="tt-course">Course</Label>
                <Select value={courseKey} onValueChange={changeCourse} disabled={courseGroups.length === 0}>
                  <SelectTrigger id="tt-course"><SelectValue placeholder="Select a course" /></SelectTrigger>
                  <SelectContent>
                    {courseGroups.map((g) => {
                      const representative = courses.find((c) => c.id === g.courseIds[0]);
                      const ambiguous = (groupNameCounts.get(g.name) ?? 0) > 1 && representative;
                      return (
                        <SelectItem key={g.key} value={g.key}>
                          {ambiguous ? `${g.name} — ${deptNameById.get(representative.departmentId) ?? "?"}` : g.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {courseGroups.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No courses set up for your department yet. Ask the Principal to add courses under Departments.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-year">Year</Label>
                <Select value={year} onValueChange={changeYear} disabled={!selectedCourse || years.length === 0}>
                  <SelectTrigger id="tt-year"><SelectValue placeholder="Select a year" /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCourse && years.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    This department teaches no years of that course yet.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tt-section">Section</Label>
                <Select
                  value={sectionId}
                  onValueChange={changeSection}
                  disabled={!year || isLoadingSections || sections.length === 0}
                >
                  <SelectTrigger id="tt-section">
                    <SelectValue
                      placeholder={isLoadingSections ? "Loading sections…" : sections.length === 0 && year ? "No sections" : "Select a section"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {sectionDisplayLabel(s, departments)} · {s.studentCount ?? 0} students
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {year && !isLoadingSections && sections.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No sections for this year. Add them under the Sections module first.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 flex flex-col justify-end">
                <Button onClick={handleLoad} disabled={!canLoad}>
                  <Search className="h-4 w-4 mr-2" />
                  {loaded ? "Reload Timetable" : "Load Timetable"}
                </Button>
              </div>
            </div>
          )}

          {/* Timetable Incharge and the department-wide Teaching Assignments
              editor are per course-YEAR, not per section, so they stay on their
              own pages - linked from here once a course and year are picked,
              rather than folded into a per-section view. */}
          {selectedCourse && year && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <UserCog className="h-3.5 w-3.5" />
                {ordinalYear(Number(year))} tools:
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/hod/timetable/${selectedCourse.id}/${year}/teaching-assignments`}>
                  <ClipboardList className="h-3.5 w-3.5 mr-1.5" />Teaching Assignments
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/hod/timetable/${selectedCourse.id}/${year}`}>
                  <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                  Timetable Incharge
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loaded ? (
        <TimetableGridEditor
          key={`${loaded.courseId}_${loaded.year}_${loaded.sectionId}`}
          courseId={loaded.courseId}
          year={loaded.year}
          sectionId={loaded.sectionId}
        />
      ) : (
        !isLoading && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            <Users className="h-5 w-5 mx-auto mb-2 opacity-50" />
            Pick a course, year and section above, then press Load Timetable.
          </div>
        )
      )}
    </div>
  );
}

export default function HODTimetablePage() {
  return <SectionTimetable />;
}
