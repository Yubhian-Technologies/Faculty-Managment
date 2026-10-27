"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { departmentsOfferingCourse } from "@/components/students/RosterFieldInputs";
import { toast } from "@/hooks/useToast";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { Course, Department, IncidentFaculty } from "@/types";

interface FacultyRow {
  id: string;
  legalName?: string;
  honorific?: string;
  employeeId?: string;
  department?: string;
}

function toFaculty(f: FacultyRow): IncidentFaculty {
  return {
    id: f.id,
    name: facultyDisplayName(f) || f.employeeId || "",
    employeeId: f.employeeId ?? "",
    department: f.department ?? "",
  };
}

// Faculty have no course of their own - the Course filter narrows to the
// departments that run that course, the same mapping the student filter uses.
export function IncidentFacultyPicker({ departments, courses, selected, onChange }: {
  departments: Department[];
  courses: Course[];
  selected: Record<string, IncidentFaculty>;
  onChange: (next: Record<string, IncidentFaculty>) => void;
}) {
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [results, setResults] = useState<FacultyRow[] | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const loadSeq = useRef(0);

  const courseNames = useMemo(
    () => Array.from(new Set(courses.map((c) => c.name?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [courses]
  );
  const departmentNames = useMemo(() => {
    const pool = courseFilter === "all"
      ? departments.filter((d) => d.isActive)
      : departmentsOfferingCourse(departments, courses, courseFilter).filter((d) => d.isActive);
    return Array.from(new Set(pool.map((d) => d.name))).sort((a, b) => a.localeCompare(b));
  }, [departments, courses, courseFilter]);

  function onCourseChange(value: string) {
    setCourseFilter(value);
    setDeptFilter("all");
  }

  async function load() {
    const seq = ++loadSeq.current;
    setIsFetching(true);
    try {
      const res = await fetch("/api/college/faculty?availableOnly=true");
      const json = await res.json() as { faculty?: FacultyRow[]; error?: string };
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load faculty" });
        return;
      }
      const q = search.trim().toLowerCase();
      const courseDepts = courseFilter === "all"
        ? null
        : new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.name));
      setResults(
        (json.faculty ?? []).filter((f) => {
          if (deptFilter !== "all" && f.department !== deptFilter) return false;
          if (courseDepts && !courseDepts.has(f.department ?? "")) return false;
          if (!q) return true;
          return (f.employeeId ?? "").toLowerCase().includes(q) || facultyDisplayName(f).toLowerCase().includes(q);
        })
      );
    } catch {
      if (seq === loadSeq.current) toast({ variant: "destructive", title: "Failed to load faculty" });
    } finally {
      if (seq === loadSeq.current) setIsFetching(false);
    }
  }

  function toggle(f: FacultyRow, checked: boolean) {
    const next = { ...selected };
    if (checked) next[f.id] = toFaculty(f);
    else delete next[f.id];
    onChange(next);
  }

  const shown = results ?? [];
  const allShownSelected = shown.length > 0 && shown.every((f) => selected[f.id]);
  function toggleAllShown(checked: boolean) {
    const next = { ...selected };
    for (const f of shown) {
      if (checked) next[f.id] = toFaculty(f);
      else delete next[f.id];
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
            placeholder="Search by Employee ID or faculty name..."
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
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="sm:w-52"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departmentNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" onClick={() => void load()} loading={isFetching}>Load</Button>
      </div>

      {results === null ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Set your filters and press Load to list faculty.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No faculty match.</p>
      ) : (
        <div className="rounded-lg border">
          <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Checkbox checked={allShownSelected} onCheckedChange={(v) => toggleAllShown(v === true)} aria-label="Select all shown faculty" />
            <span>Select all shown ({shown.length})</span>
          </label>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {shown.map((f) => (
              <li key={f.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <Checkbox checked={!!selected[f.id]} onCheckedChange={(v) => toggle(f, v === true)} aria-label={`Select ${facultyDisplayName(f)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{facultyDisplayName(f) || "-"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{f.employeeId} · {f.department}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedList.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Selected faculty ({selectedList.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedList.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
                {f.name} <span className="text-muted-foreground">({f.employeeId})</span>
                <button
                  type="button"
                  onClick={() => { const next = { ...selected }; delete next[f.id]; onChange(next); }}
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Remove ${f.name}`}
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
