"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import { departmentsOfferingCourse, yearOptionsForDepartment, yearOptionsForCourse } from "@/components/students/RosterFieldInputs";
import { LIST_ROSTER_FIELDS, rosterFieldDisplay } from "@/lib/students/rosterFields";
import type { StudentListItem, Department, AcademicYear, Course } from "@/types";

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Read-only, college-wide counterpart to college-office/students/page.tsx -
// same fetch shape (page/pageSize/search/department/course/year against
// /api/college/students, already unscoped for PRINCIPAL/VICE_PRINCIPAL - see
// UNSCOPED_ROLES in that route) and the same LIST_ROSTER_FIELDS table
// (already includes "Core Department", i.e. secondaryDepartment, so a
// freshman-year student held under a feeder department shows up correctly
// here too - see StudentRecord.secondaryDepartment's own doc-comment).
// Deliberately no Add/Edit/Delete/Import/Export - Principal browses here,
// the department (HOD) and Office own the roster itself.
export default function PrincipalStudentsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deptFilter, setDeptFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const loadMetadata = useCallback(async () => {
    try {
      const [deptsRes, yearsRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
      ]);
      setDepartments(deptsRes.departments ?? []);
      const loadedCourses = coursesRes.courses ?? [];
      setCourses(loadedCourses);
      setCourseNames(
        Array.from(new Set(loadedCourses.map((c) => c.name?.trim()).filter(Boolean) as string[]))
          .sort((a, b) => a.localeCompare(b))
      );
      const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
      const maxCourseDuration = loadedCourses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
      const capped = maxCourseDuration > 0 ? configured.filter((y) => y <= maxCourseDuration) : configured;
      setYears(capped.length > 0 ? capped : [1, 2, 3, 4]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load filter options" });
    }
  }, []);

  const loadStudents = useCallback(async () => {
    setIsFetching(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (deptFilter !== "all") params.set("department", deptFilter);
      if (courseFilter !== "all") params.set("course", courseFilter);
      if (yearFilter !== "all") params.set("year", yearFilter);

      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load students" });
        return;
      }
      const data = json.students ?? [];
      const grandTotal = json.total ?? 0;
      if (data.length === 0 && page > 1 && grandTotal > 0) {
        setPage(Math.max(1, Math.ceil(grandTotal / pageSize)));
        return;
      }
      setStudents(data);
      setTotal(grandTotal);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsFetching(false);
      setIsLoading(false);
    }
  }, [page, pageSize, debouncedSearch, deptFilter, courseFilter, yearFilter]);

  // Wrapped so the loaders' setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadMetadata(); })();
  }, [loadMetadata]);

  useEffect(() => {
    void (async () => { await loadStudents(); })();
  }, [loadStudents]);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  const departmentFilterOptions = useMemo(() => {
    if (courseFilter === "all") return activeDepartments;
    const offeringIds = new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.id));
    return activeDepartments.filter((d) => offeringIds.has(d.id));
  }, [courseFilter, activeDepartments, departments, courses]);

  const yearFilterOptions = useMemo(() => {
    if (deptFilter !== "all") {
      return yearOptionsForDepartment(departments, courses, deptFilter, courseFilter === "all" ? "" : courseFilter, years);
    }
    return yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years);
  }, [deptFilter, courseFilter, departments, courses, years]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim().toLowerCase());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  function onCourseFilterChange(value: string) {
    const nextDeptOptions = value === "all"
      ? activeDepartments
      : activeDepartments.filter((d) => new Set(departmentsOfferingCourse(departments, courses, value).map((o) => o.id)).has(d.id));
    const deptStillValid = deptFilter === "all" || nextDeptOptions.some((d) => d.name === deptFilter);
    if (!deptStillValid) setDeptFilter("all");
    const nextDept = deptStillValid ? deptFilter : "all";
    const nextYearOptions = nextDept === "all"
      ? yearOptionsForCourse(courses, value === "all" ? undefined : value, years)
      : yearOptionsForDepartment(departments, courses, nextDept, value === "all" ? "" : value, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCourseFilter(value);
    setPage(1);
  }

  function onDeptFilterChange(value: string) {
    const nextYearOptions = value === "all"
      ? yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years)
      : yearOptionsForDepartment(departments, courses, value, courseFilter === "all" ? "" : courseFilter, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setDeptFilter(value);
    setPage(1);
  }

  function onYearFilterChange(value: string) {
    setYearFilter(value);
    setPage(1);
  }

  function onPageSizeChange(value: number) {
    setPageSize(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Students" description="Every student across the college" />

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span><strong className="text-foreground">{total}</strong> students total</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, roll number or email"
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={onCourseFilterChange}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={onDeptFilterChange}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departmentFilterOptions.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={onYearFilterChange}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="All years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {yearFilterOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{total === 0 ? "No students yet" : "No students match your filters"}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {total === 0 ? "Nothing has been added to the roster yet." : "Try clearing the search or filters."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className={`p-0 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">S.No</th>
                    {LIST_ROSTER_FIELDS.map((f) => (
                      <th key={f.key} className="p-3 font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, i) => (
                    <tr
                      key={s.id}
                      onClick={() => router.push(`/principal/students/${s.id}`)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                    >
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{(page - 1) * pageSize + i + 1}</td>
                      {LIST_ROSTER_FIELDS.map((f) => {
                        const value = rosterFieldDisplay(f, s);
                        return (
                          <td key={f.key} className={`p-3 whitespace-nowrap ${f.key === "name" ? "font-medium" : ""}`}>
                            {value || <span className="text-muted-foreground/50">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={onPageSizeChange}
          disabled={isFetching}
        />
      )}
    </div>
  );
}
