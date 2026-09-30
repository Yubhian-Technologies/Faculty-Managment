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
// Selecting only changes state; data for a selection is fetched by load()
// (each page's Load button).
// Year/Semester are deliberately NOT part of this hook - Course Structure
// gets Year/Semester per XLSX row, not a dropdown; only Teaching
// Assignments needs a Year picker, and keeps that logic local to its own
// page rather than baking a rarely-shared concern in here.
// This DEPARTMENT's own Course doc for the chosen catalog entry, falling back
// to an inherited/fed one (see academics/assign-semester/page.tsx's own
// doc-comment on the "shared-year feeder" case this guards against).
export function resolveDepartmentCourse(courses: Course[], catalogId: string, departmentId: string): Course | null {
  const matches = courses.filter((c) => c.catalogId === catalogId);
  return matches.find((c) => c.departmentId === departmentId) ?? matches[0] ?? null;
}

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
  // The selection the page last loaded data for (Load button). Changing a
  // dropdown only changes the selection - nothing is fetched for it until
  // load() runs, and pages show their data only while isLoaded holds.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

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

  const selectedCourse = useMemo(
    () => resolveDepartmentCourse(courses, selectedCatalogId, selectedDepartmentId),
    [courses, selectedCatalogId, selectedDepartmentId]
  );

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
  // Resolves to the loaded list, or null when the request failed or a newer
  // one superseded it.
  const loadCourses = useCallback(async (departmentId: string): Promise<Course[] | null> => {
    const requestId = ++coursesRequestIdRef.current;
    setIsLoadingCourses(true);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses?: Course[] };
      if (requestId !== coursesRequestIdRef.current) return null;
      const list = (data.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(list);
      return list;
    } catch {
      if (requestId !== coursesRequestIdRef.current) return null;
      toast({ variant: "destructive", title: "Failed to load courses" });
      return null;
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
    // The previous department's courses no longer apply; they're fetched
    // again for this one on load().
    setCourses([]);
  }

  const selectionKey = `${selectedRegulation}|${selectedCatalogId}|${selectedDepartmentId}`;
  const isLoaded = loadedKey === selectionKey;

  // Fetches what the current selection needs: the department's courses when
  // a department is chosen, otherwise a fresh copy of the course catalog (its
  // per-regulation document links). `selection` lets a deep-link prefill load
  // values it has just set, before React state has caught up.
  // Returns the course the selection resolves to (same rule as
  // selectedCourse), so a caller can fetch its own data for it straight away
  // without waiting for state to update. `ok` is false when loading failed.
  async function load(selection?: { regulation: string; catalogId: string; departmentId: string }): Promise<{ ok: boolean; course: Course | null }> {
    const sel = selection ?? { regulation: selectedRegulation, catalogId: selectedCatalogId, departmentId: selectedDepartmentId };
    setIsLoadingData(true);
    try {
      let course: Course | null = null;
      if (sel.departmentId) {
        const list = await loadCourses(sel.departmentId);
        if (!list) return { ok: false, course: null };
        course = resolveDepartmentCourse(list, sel.catalogId, sel.departmentId);
      } else {
        const res = await fetch("/api/college/course-catalog");
        const d = await res.json() as { items?: CourseCatalogItem[] };
        setCatalogItems(d.items ?? []);
      }
      setLoadedKey(`${sel.regulation}|${sel.catalogId}|${sel.departmentId}`);
      return { ok: true, course };
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
      return { ok: false, course: null };
    } finally {
      setIsLoadingData(false);
    }
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

    load,
    isLoaded,
    isLoadingData,

    // Raw setters, for a page that needs to bypass the intrinsic
    // cascade-reset above (e.g. a deep-link prefill setting Regulation +
    // Catalog + Department together in one shot, then calling load() with
    // those values).
    setSelectedRegulation,
    setSelectedCatalogId,
    setSelectedDepartmentId,
    loadCourses,
  };
}
