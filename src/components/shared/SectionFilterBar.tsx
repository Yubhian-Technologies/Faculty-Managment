"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ordinalYear } from "@/lib/timetable/gridModel";
import { offeredYears } from "@/lib/college/departmentYears";
import { resolveBranchYearOwner } from "@/lib/departments/managedBranches";
import { isContainerDepartment } from "@/lib/departments/departmentTree";
import type { Course, Department, SectionListItem } from "@/types";

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
  // What the user explicitly picked at each level. The EFFECTIVE value below
  // falls back to the only option when a level has exactly one, so a
  // one-department HOD isn't asked to pick the only department they have
  // (derived during render - no effect, no extra state).
  const [departmentDocs, setDepartmentDocs] = useState<Department[]>([]);
  const [courseDocs, setCourseDocs] = useState<Course[]>([]);
  const [pickedDepartment, setDepartment] = useState("");
  const [pickedCourse, setCourse] = useState("");
  const [pickedYear, setYear] = useState("");
  const [pickedSectionId, setSectionId] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        if (!res.ok) throw new Error("Failed to load sections");
        const json = (await res.json()) as { sections?: SectionListItem[] };
        setSections((json.sections ?? []).filter((s) => !!s.id));
        // Departments and courses carry the assigned years and the catalogue
        // they are assigned per - best effort, since the Year list falls back
        // to the sections' own years without them.
        try {
          const [d, c] = await Promise.all([
            fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
            fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>),
          ]);
          setDepartmentDocs(d.departments ?? []);
          setCourseDocs(c.courses ?? []);
        } catch { /* falls back to the sections' own years */ }
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const courseKey = (s: SectionListItem) => s.courseName || s.courseId || "";
  const only = <T,>(options: T[], picked: T | ""): T | "" => (picked !== "" ? picked : options.length === 1 ? options[0] : "");

  // A section is filed under its real branch for every year, but the department
  // that RUNS it depends on the year: Basic Science - Maths runs CSE's first
  // year, CSE's own HOD runs years 2-4. Grouping by that year-aware owner (the
  // rule the Sections tab already uses) is what lets a manager reach the first
  // year it runs - listing only the branch name offered it years 2-4 and the
  // sections it could actually see sat in none of them. Without department
  // documents the owner is simply the branch, exactly as before.
  const catalogIdOfSection = (s: SectionListItem) => courseDocs.find((c) => c.id === s.courseId || c.mergedCourseIds?.includes(s.courseId)
    || (!!s.courseName && c.name.toLowerCase() === s.courseName.toLowerCase()))?.catalogId;
  const ownerOf = (s: SectionListItem): string =>
    departmentDocs.length > 0
      ? resolveBranchYearOwner(departmentDocs, s.department, Number(s.year), catalogIdOfSection(s))
      : s.department;
  const departments = useMemo(() => {
    const owners = new Set(sections.map(ownerOf).filter(Boolean));
    // A parent that organises its sub-departments and runs no section itself
    // is offered too: picking it means "all of its sub-departments".
    for (const name of Array.from(owners)) {
      const doc = departmentDocs.find((d) => d.name === name);
      const parent = doc?.parentDepartmentId ? departmentDocs.find((d) => d.id === doc.parentDepartmentId) : undefined;
      if (parent?.name && !owners.has(parent.name) && isContainerDepartment(parent, departmentDocs)) owners.add(parent.name);
    }
    return Array.from(owners).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, departmentDocs, courseDocs]);
  const department = only(departments, pickedDepartment);
  const inDepartment = useMemo(() => {
    const picked = departmentDocs.find((d) => d.name === department);
    return sections.filter((s) => {
      const owner = ownerOf(s);
      if (owner === department) return true;
      // Picked a parent: the sections run by any of its sub-departments.
      const ownerDoc = departmentDocs.find((d) => d.name === owner);
      return !!picked && !!ownerDoc?.parentDepartmentId && ownerDoc.parentDepartmentId === picked.id
        && isContainerDepartment(picked, departmentDocs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, department, departmentDocs, courseDocs]);
  const courses = useMemo(
    () => Array.from(new Set(inDepartment.map(courseKey).filter(Boolean))).sort(),
    [inDepartment]
  );
  const course = department ? only(courses, pickedCourse) : "";
  const inCourse = useMemo(() => inDepartment.filter((s) => courseKey(s) === course), [inDepartment, course]);
  // The years the picked department is ASSIGNED, not the years its sections
  // happen to sit in - a department given years 2-4 should not offer year 1
  // just because one shared first-year section is filed under it. Falls back
  // to the sections' years for a department nobody has configured yet.
  const years = useMemo(() => {
    const sectionYears = inCourse.map((s) => Number(s.year));
    const catalogId = courseDocs.find((c) => inCourse.some(
      (s) => c.id === s.courseId || c.mergedCourseIds?.includes(s.courseId)
        || (!!s.courseName && c.name.toLowerCase() === s.courseName.toLowerCase())
    ))?.catalogId;
    return offeredYears(departmentDocs.find((d) => d.name === department), departmentDocs, catalogId, sectionYears);
  }, [inCourse, departmentDocs, courseDocs, department]);
  const year = course ? only(years.map(String), pickedYear) : "";
  const inYear = useMemo(() => inCourse.filter((s) => String(s.year) === year), [inCourse, year]);
  const sectionOptions = useMemo(() => [...inYear].sort((a, b) => a.name.localeCompare(b.name)), [inYear]);
  const sectionId = year ? only(sectionOptions.map((s) => s.id), pickedSectionId) : "";

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
