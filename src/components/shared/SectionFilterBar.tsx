"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { SectionListItem } from "@/types";

// Department -> Course -> Year -> Section as four cascading filters on ONE
// page, replacing the multi-page drill-downs (pick a department, open a page,
// pick a course, open a page, ...). Built from a single /api/college/sections
// call - which already returns only the sections the signed-in role may see,
// so an HOD only gets their own department's options and the Principal gets
// the whole college. Nothing is fetched when a filter changes; the page that
// hosts this bar decides when to load data (its own Load button).
//
// A level with exactly one option selects itself, so a one-department HOD
// isn't asked to pick the only department they have.
export function SectionFilterBar({
  onSelect,
  disabled,
}: {
  /** Called with the chosen section, or null whenever any filter is changed/incomplete. */
  onSelect: (section: SectionListItem | null) => void;
  disabled?: boolean;
}) {
  const [sections, setSections] = useState<SectionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [department, setDepartment] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [sectionId, setSectionId] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        if (!res.ok) throw new Error("Failed to load sections");
        const json = (await res.json()) as { sections?: SectionListItem[] };
        setSections((json.sections ?? []).filter((s) => !!s.id));
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const courseKey = (s: SectionListItem) => s.courseName || s.courseId || "";
  const departments = useMemo(
    () => Array.from(new Set(sections.map((s) => s.department).filter(Boolean))).sort(),
    [sections]
  );
  const inDepartment = useMemo(() => sections.filter((s) => s.department === department), [sections, department]);
  const courses = useMemo(
    () => Array.from(new Set(inDepartment.map(courseKey).filter(Boolean))).sort(),
    [inDepartment]
  );
  const inCourse = useMemo(() => inDepartment.filter((s) => courseKey(s) === course), [inDepartment, course]);
  const years = useMemo(
    () => Array.from(new Set(inCourse.map((s) => Number(s.year)))).filter((y) => Number.isFinite(y)).sort((a, b) => a - b),
    [inCourse]
  );
  const inYear = useMemo(() => inCourse.filter((s) => String(s.year) === year), [inCourse, year]);
  const sectionOptions = useMemo(() => [...inYear].sort((a, b) => a.name.localeCompare(b.name)), [inYear]);

  // Single-option levels pick themselves (cascading down), once data is in.
  useEffect(() => {
    if (!department && departments.length === 1) setDepartment(departments[0]);
  }, [departments, department]);
  useEffect(() => {
    if (department && !course && courses.length === 1) setCourse(courses[0]);
  }, [department, courses, course]);
  useEffect(() => {
    if (course && !year && years.length === 1) setYear(String(years[0]));
  }, [course, years, year]);
  useEffect(() => {
    if (year && !sectionId && sectionOptions.length === 1) setSectionId(sectionOptions[0].id);
  }, [year, sectionOptions, sectionId]);

  // Report the resolved section upward (null while any level is unpicked).
  useEffect(() => {
    onSelect(sections.find((s) => s.id === sectionId) ?? null);
    // onSelect is the host's own state setter; intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, sections]);

  function pickDepartment(v: string) { setDepartment(v); setCourse(""); setYear(""); setSectionId(""); }
  function pickCourse(v: string) { setCourse(v); setYear(""); setSectionId(""); }
  function pickYear(v: string) { setYear(v); setSectionId(""); }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-md border bg-muted/30 animate-pulse" />)}
      </div>
    );
  }
  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No sections are available to you yet.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <Label>Department</Label>
        <Select value={department} onValueChange={pickDepartment} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder="Select a department" /></SelectTrigger>
          <SelectContent>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Course</Label>
        <Select value={course} onValueChange={pickCourse} disabled={disabled || !department}>
          <SelectTrigger><SelectValue placeholder="Select a course" /></SelectTrigger>
          <SelectContent>
            {courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Year</Label>
        <Select value={year} onValueChange={pickYear} disabled={disabled || !course}>
          <SelectTrigger><SelectValue placeholder="Select a year" /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Section</Label>
        <Select value={sectionId} onValueChange={setSectionId} disabled={disabled || !year}>
          <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
          <SelectContent>
            {sectionOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}{s.batch ? ` · ${s.batch}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
