"use client";

import { useEffect, useMemo, useState } from "react";
import type { SectionFilterSource } from "@/lib/students/sectionFilter";

/**
 * The department names that at least one section is filed under, for the
 * Students / attendance-report filters.
 *
 * A department picker built from the department list alone offers choices that
 * can only come back empty: at one live college "Basic Science" carries no
 * sections and no students at all - its four sub-departments do the real work.
 * See lib/college/departmentSectionScope.ts and lib/departments/departmentTree.ts
 * for the rules this feeds.
 *
 * Deliberately best-effort and silent: this only decides which options a filter
 * shows, so a failed read leaves the caller with an empty list rather than an
 * error toast on top of whatever the page is already reporting.
 *
 * `loaded` is true once the read has finished (successfully or not). A caller
 * that has to DECIDE something from the names - "does this parent hold any
 * sections of its own?" - must wait for it, or an empty list reads as "none".
 */
export function useSectionDepartmentState(): { names: string[]; loaded: boolean } {
  const { sections, loaded } = useCollegeSectionList();
  return useMemo(() => ({ names: sectionDepartmentNames(sections), loaded }), [sections, loaded]);
}

/** The department names that at least one of `sections` is filed under. */
export function sectionDepartmentNames(sections: SectionFilterSource[]): string[] {
  return Array.from(new Set(sections.map((s) => (s.department ?? "").trim()).filter(Boolean)));
}

/**
 * The college's sections (name, department, cross-listed branches, year) - one
 * read of /api/college/sections. For a page that needs both the department
 * names above and the section names for its Section filter, so it reads once.
 * Same best-effort contract as useSectionDepartmentState: a failed read leaves
 * `sections` empty and `loaded` false.
 */
export function useCollegeSectionList(): { sections: SectionFilterSource[]; loaded: boolean } {
  const [state, setState] = useState<{ sections: SectionFilterSource[]; loaded: boolean }>({ sections: [], loaded: false });

  useEffect(() => {
    let alive = true;
    void (async () => {
      let found: SectionFilterSource[] = [];
      let ok = false;
      try {
        const res = await fetch("/api/college/sections");
        if (res.ok) {
          const json = (await res.json()) as { sections?: SectionFilterSource[] };
          found = (json.sections ?? []).map((s) => ({
            name: s.name, department: s.department, secondaryDepartments: s.secondaryDepartments, year: s.year,
          }));
          ok = true;
        }
      } catch { /* filters fall back to showing nothing extra */ }
      // A failed read stays "not loaded" so nothing is decided from an empty list.
      if (alive) setState({ sections: found, loaded: ok });
    })();
    return () => { alive = false; };
  }, []);

  return state;
}

export function useSectionDepartments(): string[] {
  return useSectionDepartmentState().names;
}
