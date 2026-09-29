"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, Department } from "@/types";

// The Regulation -> Course (catalog-level) -> Department cascade shared by
// every Academics tab (Regulation, Course Structure, Teaching Assignments,
// Syllabus) - extracted verbatim from academics/assign-semester/page.tsx
// (this session's own fixes to it: the "prefer this department's own
// Course doc over a shared-year feeder's" selectedCourse resolution, and
// the loadCourses out-of-order-response race guard, both included here).
// Year/Semester are deliberately NOT part of this hook - Course Structure
// gets Year/Semester per XLSX row, not a dropdown; only Teaching
// Assignments needs a Year picker, and keeps that logic local to its own
// page rather than baking a rarely-shared concern in here.
export function useRegulationCourseDepartmentPicker() {
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  const [selectedRegulation, setSelectedRegulation] = useState("");
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => {
        const all = d.departments ?? [];
        setAllDepartments(all);
        const topLevel = all.filter((dept) => !dept.parentDepartmentId);
        setDepartments(topLevel.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => { /* non-critical - regulation list just stays empty */ });
  }, []);

  const catalogById = useMemo(() => new Map(catalogItems.map((c) => [c.id, c])), [catalogItems]);

  const topLevelRegulationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of catalogItems) for (const r of c.regulations ?? []) set.add(r);
    return Array.from(set).sort();
  }, [catalogItems]);

  const catalogOptions = useMemo(
    () => catalogItems.filter((c) => (c.regulations ?? []).includes(selectedRegulation)).sort((a, b) => a.name.localeCompare(b.name)),
    [catalogItems, selectedRegulation]
  );
  const selectedCatalogItem = useMemo(() => catalogById.get(selectedCatalogId) ?? null, [catalogById, selectedCatalogId]);

  const selectedDepartment = useMemo(
    () => allDepartments.find((d) => d.id === selectedDepartmentId) ?? null,
    [allDepartments, selectedDepartmentId]
  );

  // This DEPARTMENT's own Course doc for the already-chosen catalog entry -
  // see academics/assign-semester/page.tsx's own doc-comment on this exact
  // memo for the full "shared-year feeder" explanation this session traced
  // a real bug back to.
  const selectedCourse = useMemo(() => {
    const matches = courses.filter((c) => c.catalogId === selectedCatalogId);
    return matches.find((c) => c.departmentId === selectedDepartmentId) ?? matches[0] ?? null;
  }, [courses, selectedCatalogId, selectedDepartmentId]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, Department[]>();
    for (const d of allDepartments) {
      if (d.parentDepartmentId) {
        const list = map.get(d.parentDepartmentId) ?? [];
        list.push(d);
        map.set(d.parentDepartmentId, list);
      }
    }
    return map;
  }, [allDepartments]);

  const isSubDept = !!selectedDepartmentId && allDepartments.some((d) => d.id === selectedDepartmentId && d.parentDepartmentId);

  const coursesRequestIdRef = useRef(0);
  const loadCourses = useCallback(async (departmentId: string) => {
    const requestId = ++coursesRequestIdRef.current;
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses?: Course[] };
      if (requestId !== coursesRequestIdRef.current) return;
      setCourses((data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      if (requestId !== coursesRequestIdRef.current) return;
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      if (requestId === coursesRequestIdRef.current) setIsLoadingCourses(false);
    }
  }, []);

  function selectRegulation(regulation: string) {
    setSelectedRegulation(regulation);
    setSelectedCatalogId("");
    setSelectedDepartmentId("");
    setCourses([]);
  }

  function selectCatalog(catalogId: string) {
    setSelectedCatalogId(catalogId);
    setSelectedDepartmentId("");
    setCourses([]);
  }

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    void loadCourses(departmentId);
  }

  return {
    isLoading,
    isLoadingCourses,
    allDepartments,
    departments,
    childrenOf,
    catalogItems,
    catalogById,
    topLevelRegulationOptions,
    catalogOptions,
    courses,

    selectedRegulation,
    selectedCatalogId,
    selectedDepartmentId,
    selectedCatalogItem,
    selectedDepartment,
    selectedCourse,
    isSubDept,

    selectRegulation,
    selectCatalog,
    selectDepartment,

    // Raw setters, for a page that needs to bypass the intrinsic
    // cascade-reset above (e.g. a deep-link prefill setting Regulation +
    // Catalog + Department together in one shot, then explicitly calling
    // loadCourses itself once).
    setSelectedRegulation,
    setSelectedCatalogId,
    setSelectedDepartmentId,
    loadCourses,
  };
}
