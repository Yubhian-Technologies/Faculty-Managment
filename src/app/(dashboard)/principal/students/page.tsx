"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import { departmentsOfferingCourse, yearOptionsForDepartment, yearOptionsForCourse } from "@/components/students/RosterFieldInputs";
import { LIST_ROSTER_FIELDS, rosterFieldDisplay } from "@/lib/students/rosterFields";
import { StudentDepartmentCell } from "@/components/students/StudentDepartmentCell";
import { StudentPromotionsPanel } from "@/components/students/StudentPromotionsPanel";
import { StudentStrengthDashboard } from "@/components/students/StudentStrengthDashboard";
import { StudentsViewTabs } from "@/components/students/StudentsViewTabs";
import { GraduatedStudentsView } from "@/components/students/GraduatedStudentsView";
import type { StudentListItem, Department, AcademicYear, Course } from "@/types";
import { selectableYears } from "@/lib/college/courseYears";
import { DepartmentPickSelect } from "@/components/shared/DepartmentPickSelect";
import {
  buildDepartmentPickOptions, DEPARTMENT_PICK_ALL, departmentPickValue, isDepartmentPickOffered, parseDepartmentPick,
} from "@/lib/departments/departmentPickTree";
import { useSectionDepartments } from "@/hooks/useSectionDepartments";
import { useListUrlSync } from "@/hooks/useListUrlSync";
import { buildListUrl, readListChoice, readListInt, readListString, withListBack } from "@/lib/listReturn";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZES = [10, 20, 30, 50]; // Pagination's options
const LIST_PATH = "/principal/students";

// Promotion and Graduated Students used to be separate sidebar tabs; they now
// live here as sub-tabs (top-right pills, next to the page title) so all
// student-lifecycle actions sit under one "Students" entry in the nav.
const STUDENT_TABS = [
  { key: "roster", label: "All Students" },
  { key: "strength", label: "Students Strength" },
  { key: "promotion", label: "Promotion" },
  { key: "graduates", label: "Graduated" },
] as const;
type StudentTabKey = (typeof STUDENT_TABS)[number]["key"];

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
function PrincipalStudentsContent() {
  const router = useRouter();
  // What the list was showing (tab, filters, search, page) when a student was
  // opened from it, or when the page was refreshed - read once, on arrival; the
  // list then mirrors its own state back into the URL (listUrl below).
  const searchParams = useSearchParams();
  const [restored] = useState(() => ({
    load: searchParams.get("load") === "1",
    tab: readListChoice(searchParams, "tab", STUDENT_TABS.map((t) => t.key), "roster"),
    search: readListString(searchParams, "q", ""),
    department: readListString(searchParams, "department", "all"),
    coreDepartment: readListString(searchParams, "coreDepartment", "all"),
    course: readListString(searchParams, "course", "all"),
    year: /^\d+$/.test(searchParams.get("year") ?? "") ? (searchParams.get("year") as string) : "all",
    page: readListInt(searchParams, "page", 1),
    pageSize: readListInt(searchParams, "pageSize", DEFAULT_PAGE_SIZE, { allowed: PAGE_SIZES }),
  }));
  const [activeTab, setActiveTab] = useState<StudentTabKey>(restored.tab);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  // A restored list loads itself on arrival (once the filter options are in), so
  // it starts out loading rather than flashing the empty state.
  const [isFetching, setIsFetching] = useState(restored.load);

  // The pickers below are a DRAFT: nothing is read until Load. `applied` is what the last Load
  // asked for (and what the URL and the table show); `nonce` makes a repeat Load re-read.
  const [search, setSearch] = useState(restored.search);
  // One Department pick: sub-departments and core branches sit under their department.
  const [deptPick, setDeptPick] = useState(
    departmentPickValue(restored.department === "all" ? "" : restored.department, restored.coreDepartment === "all" ? "" : restored.coreDepartment)
  );
  const { department: pickedDept, coreDepartment: pickedCore } = parseDepartmentPick(deptPick);
  const deptFilter = pickedDept || "all";
  const coreDeptFilter = pickedCore || "all";
  const [yearFilter, setYearFilter] = useState<string>(restored.year);
  const [courseFilter, setCourseFilter] = useState<string>(restored.course);
  type Applied = { search: string; dept: string; core: string; course: string; year: string; nonce: number };
  const [applied, setApplied] = useState<Applied | null>(() =>
    restored.load
      ? { search: restored.search.trim().toLowerCase(), dept: restored.department, core: restored.coreDepartment, course: restored.course, year: restored.year, nonce: 0 }
      : null
  );
  const hasLoaded = applied !== null;
  const [page, setPage] = useState(restored.page);
  const [pageSize, setPageSize] = useState(restored.pageSize);

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
      setYears(selectableYears(configured, loadedCourses));
    } catch {
      toast({ variant: "destructive", title: "Failed to load filter options" });
    } finally {
      setIsMetadataLoading(false);
    }
  }, []);

  const executeLoad = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
    setIsFetching(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("pageSize", String(targetPageSize));
      if (!applied) return;
      if (applied.search) params.set("search", applied.search);
      if (applied.dept !== "all") params.set("department", applied.dept);
      if (applied.core !== "all") params.set("coreDepartment", applied.core);
      if (applied.course !== "all") params.set("course", applied.course);
      if (applied.year !== "all") params.set("year", applied.year);
      // "All years" for a department means the years it actually teaches - a
      // department filter matches Core Department too, so without this a branch
      // teaching years 2-4 also returned its feeder's 1st years.
      else if (applied.dept !== "all") {
        const configured = yearOptionsForDepartment(departments, courses, applied.dept, applied.course === "all" ? "" : applied.course, years);
        if (configured.length > 0) params.set("years", configured.join(","));
      }

      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as { students?: StudentListItem[]; total?: number; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load students" });
        return;
      }
      const data = json.students ?? [];
      const grandTotal = json.total ?? 0;
      if (data.length === 0 && targetPage > 1 && grandTotal > 0) {
        const lastPage = Math.max(1, Math.ceil(grandTotal / targetPageSize));
        setPage(lastPage);
        return;
      }
      setStudents(data);
      setTotal(grandTotal);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsFetching(false);
    }
  }, [page, pageSize, applied, departments, courses, years]);

  // Load filter metadata once on mount
  useEffect(() => {
    void (async () => { await loadMetadata(); })();
  }, [loadMetadata]);

  // Re-reads on Load (a new `applied`) and on page / page size - never on a filter edit.
  // Waits for the filter options (a restored list is "loaded" before they arrive):
  // the department's configured years, part of the query, come from them.
  useEffect(() => {
    if (!hasLoaded || isMetadataLoading) return;
    void executeLoad(page, pageSize);
  }, [hasLoaded, isMetadataLoading, page, pageSize, applied, executeLoad]);

  // The list's own URL: tab, what is loaded, filters, search, page and page size.
  // Kept in the address bar so a refresh or the browser's Back button restores the
  // view, and carried to a student's profile in `?back=` for its Back button.
  const listUrl = useMemo(
    () => buildListUrl(
      LIST_PATH,
      {
        tab: activeTab, load: hasLoaded, department: applied?.dept ?? "all", coreDepartment: applied?.core ?? "all", course: applied?.course ?? "all",
        year: applied?.year ?? "all", q: applied?.search ?? "", page, pageSize,
      },
      { tab: "roster", department: "all", coreDepartment: "all", course: "all", year: "all", page: 1, pageSize: DEFAULT_PAGE_SIZE }
    ),
    [activeTab, hasLoaded, applied, page, pageSize]
  );
  useListUrlSync(listUrl, LIST_PATH);

  // Which departments a section is actually filed under - the Department filter
  // is drawn from these, not from the whole department list.
  const sectionDepartments = useSectionDepartments();

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  // Only the departments that resolve to sections - their own, or those of a branch they manage - plus a
  // parent that organises sub-departments; each sub-department and each core branch is listed beneath the
  // department that owns it (one field, no separate Core department). See lib/departments/departmentPickTree.ts.
  const departmentPickOptions = useMemo(() => {
    const offered = courseFilter === "all"
      ? activeDepartments
      : (() => {
        const offeringIds = new Set(departmentsOfferingCourse(departments, courses, courseFilter).map((d) => d.id));
        return activeDepartments.filter((d) => offeringIds.has(d.id));
      })();
    return buildDepartmentPickOptions(offered, departments, sectionDepartments);
  }, [courseFilter, activeDepartments, departments, courses, sectionDepartments]);

  const yearFilterOptions = useMemo(() => {
    if (deptFilter !== "all") {
      return yearOptionsForDepartment(departments, courses, deptFilter, courseFilter === "all" ? "" : courseFilter, years);
    }
    return yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years);
  }, [deptFilter, courseFilter, departments, courses, years]);

  function onSearchChange(value: string) {
    setSearch(value);
  }

  function onCourseFilterChange(value: string) {
    const nextOptions = value === "all"
      ? activeDepartments
      : activeDepartments.filter((d) => new Set(departmentsOfferingCourse(departments, courses, value).map((o) => o.id)).has(d.id));
    const nextPickOptions = buildDepartmentPickOptions(nextOptions, departments, sectionDepartments);
    const pickStillValid = isDepartmentPickOffered(nextPickOptions, deptPick);
    if (!pickStillValid) setDeptPick(DEPARTMENT_PICK_ALL);
    const nextDept = pickStillValid ? deptFilter : "all";
    const nextYearOptions = nextDept === "all"
      ? yearOptionsForCourse(courses, value === "all" ? undefined : value, years)
      : yearOptionsForDepartment(departments, courses, nextDept, value === "all" ? "" : value, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setCourseFilter(value);
  }

  function onDeptPickChange(value: string) {
    const { department } = parseDepartmentPick(value);
    const nextYearOptions = !department
      ? yearOptionsForCourse(courses, courseFilter === "all" ? undefined : courseFilter, years)
      : yearOptionsForDepartment(departments, courses, department, courseFilter === "all" ? "" : courseFilter, years);
    if (yearFilter !== "all" && !nextYearOptions.includes(Number(yearFilter))) setYearFilter("all");
    setDeptPick(value);
  }

  function onYearFilterChange(value: string) {
    setYearFilter(value);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
  }

  function handlePageSizeChange(newPageSize: number) {
    setPageSize(newPageSize);
    setPage(1);
  }

  const filtersChanged = applied !== null && (
    applied.search !== search.trim().toLowerCase() || applied.dept !== deptFilter || applied.core !== coreDeptFilter
    || applied.course !== courseFilter || applied.year !== yearFilter
  );

  // The only thing that reads: freeze the pickers as `applied`; the effect above fetches.
  function handleLoad() {
    setPage(1);
    setApplied((prev) => ({
      search: search.trim().toLowerCase(), dept: deptFilter, core: coreDeptFilter, course: courseFilter, year: yearFilter,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={
          activeTab === "strength"
            ? "Live student counts by department, year and section - generated from the student records"
            : activeTab === "promotion"
            ? "Move a cohort to the next year"
            : activeTab === "graduates"
            ? "Every student who has completed their programme"
            : "Every student across the college"
        }
        actions={
          <StudentsViewTabs tabs={STUDENT_TABS} value={activeTab} onChange={setActiveTab} />
        }
      />

      {activeTab === "strength" ? (
        <StudentStrengthDashboard />
      ) : activeTab === "promotion" ? (
        <StudentPromotionsPanel showHeader={false} />
      ) : activeTab === "graduates" ? (
        <GraduatedStudentsView showHeader={false} studentDetailHref={(id) => withListBack(`/principal/students/${id}`, listUrl, LIST_PATH)} />
      ) : (
        <>
          {hasLoaded && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span><strong className="text-foreground">{total}</strong> students total</span>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleLoad();
                  }
                }}
                placeholder="Search by name, Regd. No or email"
                className="pl-9"
              />
            </div>
            <Select value={courseFilter} onValueChange={onCourseFilterChange}>
              <SelectTrigger className="sm:w-48"><SelectValue placeholder="All courses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <DepartmentPickSelect value={deptPick} onChange={onDeptPickChange} options={departmentPickOptions} className="sm:w-56" />
            <Select value={yearFilter} onValueChange={onYearFilterChange}>
              <SelectTrigger className="sm:w-36"><SelectValue placeholder="All years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {yearFilterOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              type="button"
              onClick={handleLoad}
              disabled={isFetching || isMetadataLoading}
              className="whitespace-nowrap"
            >
              {isFetching ? "Loading…" : filtersChanged ? "Apply filters" : hasLoaded ? "Refresh" : "Load"}
            </Button>
          </div>

          {!hasLoaded ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg bg-card">
              <Users className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium text-base">Click Load to view students</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Select your filters above (or leave as all) and click Load to fetch the student roster with pagination.
              </p>
            </div>
          ) : isFetching && students.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
            </div>
          ) : students.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg bg-card">
              <Users className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">{total === 0 ? "No students found" : "No students match your filters"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {total === 0 ? "Nothing has been added to the roster yet." : "Try adjusting your search or filters."}
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
                          onClick={() => router.push(withListBack(`/principal/students/${s.id}`, listUrl, LIST_PATH))}
                          className={`border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors ${i % 2 === 0 ? "" : "bg-muted/20"}`}
                        >
                          <td className="p-3 text-muted-foreground whitespace-nowrap">{(page - 1) * pageSize + i + 1}</td>
                          {LIST_ROSTER_FIELDS.map((f) => {
                            const value = rosterFieldDisplay(f, s);
                            return (
                              <td key={f.key} className={`p-3 whitespace-nowrap ${f.key === "name" ? "font-medium" : ""}`}>
                                {f.key === "department"
                              ? <StudentDepartmentCell department={value} coreDepartment={s.secondaryDepartment} />
                              : value || <span className="text-muted-foreground/50">—</span>}
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

          {hasLoaded && total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              disabled={isFetching}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function PrincipalStudentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground animate-pulse">Loading students...</div>}>
      <PrincipalStudentsContent />
    </Suspense>
  );
}
