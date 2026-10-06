"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Search, UserCog, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";
import { toast } from "@/hooks/useToast";
import { yearSemesterLabel } from "@/lib/academic/format";
import { ordinalYear } from "@/lib/timetable/gridModel";
import { findBranchManager } from "@/lib/departments/managedBranches";
import type { CourseYearTiming, Department, Section, TimetableIncharge } from "@/types";

// A delegated Timetable Incharge's whole timetable workflow on ONE page:
// pick the course-year they were made responsible for, pick a section, press
// Load, and the grid opens in place. Replaces the cards -> section list ->
// grid chain of pages, and is the single implementation behind both
// panel/timetable-incharge and college-staff/timetable-incharge (they used to
// be near-identical copies). Teaching Assignments stays its own page - it is
// a different editor, not another step of this one.
export function InchargeTimetableWorkspace({ basePath }: { basePath: string }) {
  const [incharges, setIncharges] = useState<TimetableIncharge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [unit, setUnit] = useState(""); // `${owner}|${year}`
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [semester, setSemester] = useState<number | null>(null);
  // Semesters are configured per course-year, filed under each section's own courseId.
  const [timings, setTimings] = useState<Record<string, CourseYearTiming | null>>({});
  const [loaded, setLoaded] = useState<{ courseId: string; year: string; sectionId: string; semester: number | null } | null>(null);

  // Every section of every course-year this person is Incharge for. One request
  // per course-year: the sections API recognises a delegated Incharge only on a
  // single-course lookup, so a combined courseId list would fall back to
  // ordinary department scoping and return nothing.
  const [allSections, setAllSections] = useState<Section[]>([]);

  // One entry per managing sub-department and year (e.g. "BASIC SCIENCE MATHS ·
  // 1st Year"), worked out from each SECTION's own branch - the Incharge record
  // only names the course's department ("BASIC SCIENCE"), which is the core
  // department and says nothing about which sub-department a branch sits under.
  const ownerOf = (sec: Section) => findBranchManager(departments, sec.department)?.department.name ?? sec.department;
  const units = useMemo(() => {
    const map = new Map<string, { key: string; ownerName: string; year: number; courseIds: string[] }>();
    for (const sec of allSections) {
      const ownerName = findBranchManager(departments, sec.department)?.department.name ?? sec.department;
      const key = `${ownerName}|${sec.year}`;
      const existing = map.get(key);
      if (existing) { if (!existing.courseIds.includes(sec.courseId)) existing.courseIds.push(sec.courseId); }
      else map.set(key, { key, ownerName, year: Number(sec.year), courseIds: [sec.courseId] });
    }
    return Array.from(map.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.year - b.year);
  }, [allSections, departments]);

  async function loadSections(key: string) {
    const target = units.find((u) => u.key === key);
    if (!target) return;
    const year = String(target.year);
    setIsLoadingSections(true);
    try {
      const list = allSections
        .filter((sec) => Number(sec.year) === target.year && ownerOf(sec) === target.ownerName)
        .sort((a, b) => a.name.localeCompare(b.name));
      setSections(list);
      setSectionId(list.length === 1 ? list[0].id : "");
      const targetCourseIds = Array.from(new Set(list.map((s) => s.courseId))).filter(Boolean);
      if (targetCourseIds.length > 0) {
        const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(targetCourseIds.join(","))}`)
          .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
          .catch(() => ({ timings: [] as CourseYearTiming[] }));
        const fetchedTimings = res.timings ?? [];
        const entries = targetCourseIds.map((id) => [
          id,
          fetchedTimings.find((x) => x.courseId === id && Number(x.year) === Number(year)) ?? null,
        ] as const);
        setTimings(Object.fromEntries(entries));
      } else {
        setTimings({});
      }
    } catch {
      setSections([]);
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoadingSections(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [res, deptRes] = await Promise.all([
          fetch("/api/college/timetable-incharges?mine=true"),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>).catch(() => ({ departments: [] as Department[] })),
        ]);
        const data = (await res.json()) as { incharges?: TimetableIncharge[] };
        const mine = data.incharges ?? [];
        setDepartments(deptRes.departments ?? []);
        setIncharges(mine);
        const pairs = Array.from(new Map(mine.map((i) => [`${i.courseId}|${i.year}`, i])).values());
        const lists = await Promise.all(pairs.map((i) =>
          fetch(`/api/college/sections?courseId=${encodeURIComponent(i.courseId)}&year=${encodeURIComponent(String(i.year))}`)
            .then((r) => r.json() as Promise<{ sections?: Section[] }>)
            .then((d) => d.sections ?? [])
            .catch(() => [] as Section[])));
        const seen = new Set<string>();
        setAllSections(lists.flat().filter((sec) => !!sec.id && !seen.has(sec.id) && !!seen.add(sec.id)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load your Timetable responsibilities" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // A single responsibility needs no picking.
  const effectiveUnit = unit || (units.length === 1 ? units[0].key : "");
  const selected = units.find((u) => u.key === effectiveUnit) ?? null;

  // A lone responsibility is auto-picked - fetch its sections once it is known.
  const soleKey = units.length === 1 ? units[0].key : "";
  useEffect(() => {
    if (soleKey) void (async () => { await loadSections(soleKey); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleKey]);

  const semesterOptions = Array.from(new Set(sections.flatMap((s) => (timings[s.courseId]?.semesters ?? []).map((x) => x.semester)))).sort((a, b) => a - b);
  // A chosen semester narrows the sections to the course-years that run it.
  const sectionsForPick = sections.filter((s) => {
    const sems = (timings[s.courseId]?.semesters ?? []).map((x) => x.semester);
    return semester == null || sems.length === 0 || sems.includes(semester);
  });

  function pickUnit(key: string) {
    setUnit(key);
    setLoaded(null);
    setSemester(null);
    setTimings({});
    setSectionId("");
    setSections([]);
    void loadSections(key);
  }

  function handleLoad() {
    const section = sections.find((s) => s.id === sectionId);
    if (!selected || !section) return;
    // The section's OWN courseId (a shared-year section can be filed under a
    // sibling branch's Course doc) - same rule as hod/timetable.
    setLoaded({ courseId: section.courseId, year: String(selected.year), sectionId: section.id, semester });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Pick the course & year you are Timetable Incharge for, a semester and a section, then load its timetable"
      />

      {isLoading ? (
        <div className="h-32 rounded-lg border bg-muted/30 animate-pulse" />
      ) : incharges.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-6 w-6" />}
          title="No responsibilities assigned yet"
          description="Once your HOD makes you Timetable Incharge for a course & year, it shows up here."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Find a section</CardTitle>
              <CardDescription>Nothing loads until you press Load.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Sub-department &amp; year</Label>
                  <Select value={effectiveUnit} onValueChange={pickUnit}>
                    <SelectTrigger><SelectValue placeholder="Select a sub-department & year" /></SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.key} value={u.key}>
                          {u.ownerName} · {ordinalYear(u.year)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Semester</Label>
                  <Select
                    value={semester != null ? String(semester) : "all"}
                    onValueChange={(v) => { setSemester(v === "all" ? null : Number(v)); setSectionId(""); setLoaded(null); }}
                    disabled={!effectiveUnit || isLoadingSections || semesterOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!effectiveUnit ? "Select a course & year" : semesterOptions.length === 0 ? "No semesters" : "All semesters"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All semesters</SelectItem>
                      {semesterOptions.map((n) => <SelectItem key={n} value={String(n)}>{yearSemesterLabel(n)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Select
                    value={sectionId}
                    onValueChange={(v) => { setSectionId(v); setLoaded(null); }}
                    disabled={!effectiveUnit || isLoadingSections || sectionsForPick.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingSections ? "Loading sections…" : effectiveUnit && sections.length === 0 ? "No sections" : "Select a section"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sectionsForPick.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} · {s.studentCount ?? 0} students</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <Button onClick={handleLoad} disabled={!sectionId}>
                    <Search className="mr-2 h-4 w-4" />{loaded ? "Reload Timetable" : "Load Timetable"}
                  </Button>
                </div>
              </div>
              {selected && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${basePath}/${selected.courseIds[0]}/${selected.year}/teaching-assignments`}>
                      <ClipboardList className="mr-1.5 h-3.5 w-3.5" />Teaching Assignments
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {loaded ? (
            <TimetableGridEditor
              key={`${loaded.courseId}_${loaded.year}_${loaded.sectionId}_${loaded.semester ?? ""}`}
              courseId={loaded.courseId}
              year={loaded.year}
              sectionId={loaded.sectionId}
              semester={loaded.semester}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-5 w-5 opacity-50" />
              Pick a course & year, a semester and a section above, then press Load Timetable.
            </div>
          )}
        </>
      )}
    </div>
  );
}
