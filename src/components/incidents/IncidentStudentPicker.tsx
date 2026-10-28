"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DepartmentPickSelect } from "@/components/shared/DepartmentPickSelect";
import { departmentsOfferingCourse, yearOptionsForCourse, yearOptionsForDepartment } from "@/components/students/RosterFieldInputs";
import { useSectionDepartments } from "@/hooks/useSectionDepartments";
import { toast } from "@/hooks/useToast";
import {
  buildDepartmentPickOptions, DEPARTMENT_PICK_ALL, isDepartmentPickOffered, parseDepartmentPick,
} from "@/lib/departments/departmentPickTree";
import type { Course, Department, IncidentStudent, StudentListItem } from "@/types";

// Matches the page size the Students list uses; past this the person narrows
// the filters rather than paging - this is a picker, not a roster.
const RESULT_LIMIT = 50;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export function IncidentStudentPicker({ departments, courses, years, selected, onChange }: {
  departments: Department[];
  courses: Course[];
  years: number[];
  selected: Record<string, IncidentStudent>;
  onChange: (next: Record<string, IncidentStudent>) => void;
}) {
  const sectionDepartments = useSectionDepartments();
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [deptPick, setDeptPick] = useState(DEPARTMENT_PICK_ALL);
  const [yearFilter, setYearFilter] = useState("all");
  const [results, setResults] = useState<StudentListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const loadSeq = useRef(0);

  const courseNames = useMemo(
    () => Array.from(new Set(courses.map((c) => c.name?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [courses]
  );
  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );
  const { department: pickedDept, coreDepartment: pickedCore } = parseDepartmentPick(deptPick);

  const departmentOptions = useMemo(() => {
    const offered = courseFilter === "all"
      ? activeDepartments
      : (() => {
        const ids = new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.id));
        return activeDepartments.filter((d) => ids.has(d.id));
      })();
    return buildDepartmentPickOptions(offered, departments, sectionDepartments);
  }, [courseFilter, activeDepartments, departments, courses, sectionDepartments]);

  const yearOptions = useMemo(
    () => pickedDept
      ? yearOptionsForDepartment(departments, courses, pickedDept, courseFilter === "all" ? "" : courseFilter, years)
      : yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years),
    [pickedDept, courseFilter, departments, courses, years]
  );

  function onCourseChange(value: string) {
    const offered = value === "all"
      ? activeDepartments
      : activeDepartments.filter((d) => new Set(departmentsOfferingCourse(departments, courses, value).map((o) => o.id)).has(d.id));
    if (!isDepartmentPickOffered(buildDepartmentPickOptions(offered, departments, sectionDepartments), deptPick)) {
      setDeptPick(DEPARTMENT_PICK_ALL);
    }
    setYearFilter("all");
    setCourseFilter(value);
  }

  function onDeptChange(value: string) {
    setDeptPick(value);
    setYearFilter("all");
  }

  async function load() {
    const seq = ++loadSeq.current;
    setIsFetching(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (pickedDept) params.set("department", pickedDept);
      if (pickedCore) params.set("coreDepartment", pickedCore);
      if (courseFilter !== "all") params.set("course", courseFilter);
      if (yearFilter !== "all") params.set("year", yearFilter);
      else if (pickedDept && yearOptions.length > 0) params.set("years", yearOptions.join(","));
      params.set("page", "1");
      params.set("pageSize", String(RESULT_LIMIT));
      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; error?: string };
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load students" });
        return;
      }
      setResults(json.students ?? []);
      setTotal(json.total ?? 0);
    } catch {
      if (seq === loadSeq.current) toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      if (seq === loadSeq.current) setIsFetching(false);
    }
  }

  function toStudent(s: StudentListItem): IncidentStudent {
    return {
      id: s.id, name: s.name, rollNumber: s.rollNumber,
      course: s.course ?? "", department: s.department, year: typeof s.year === "number" ? s.year : null,
    };
  }

  function toggle(s: StudentListItem, checked: boolean) {
    const next = { ...selected };
    if (checked) next[s.id] = toStudent(s);
    else delete next[s.id];
    onChange(next);
  }

  const shown = results ?? [];
  const allShownSelected = shown.length > 0 && shown.every((s) => selected[s.id]);
  function toggleAllShown(checked: boolean) {
    const next = { ...selected };
    for (const s of shown) {
      if (checked) next[s.id] = toStudent(s);
      else delete next[s.id];
    }
    onChange(next);
  }

  const selectedList = Object.values(selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
            placeholder="Search by Regd. No. or name..."
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={onCourseChange}>
          <SelectTrigger className="sm:w-48"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <DepartmentPickSelect value={deptPick} onChange={onDeptChange} options={departmentOptions} className="sm:w-52" />
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="sm:w-36"><SelectValue placeholder="All years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" onClick={() => void load()} loading={isFetching}>Load</Button>
      </div>

      {results === null ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Set your filters and press Load to list students.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No students match.</p>
      ) : (
        <div className="rounded-lg border">
          <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Checkbox checked={allShownSelected} onCheckedChange={(v) => toggleAllShown(v === true)} aria-label="Select all shown students" />
            <span>Select all shown ({shown.length}{total > shown.length ? ` of ${total} - narrow the filters to see the rest` : ""})</span>
          </label>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {shown.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <Checkbox checked={!!selected[s.id]} onCheckedChange={(v) => toggle(s, v === true)} aria-label={`Select ${s.name}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.rollNumber}{s.course ? ` · ${s.course}` : ""} · {s.department}{s.year ? ` · ${ordinalYear(s.year)}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedList.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Selected students ({selectedList.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedList.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
                {s.name} <span className="text-muted-foreground">({s.rollNumber})</span>
                <button
                  type="button"
                  onClick={() => { const next = { ...selected }; delete next[s.id]; onChange(next); }}
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Remove ${s.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
