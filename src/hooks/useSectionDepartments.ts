"use client";

import { useEffect, useState } from "react";

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
  const [state, setState] = useState<{ names: string[]; loaded: boolean }>({ names: [], loaded: false });

  useEffect(() => {
    let alive = true;
    void (async () => {
      let found: string[] = [];
      let ok = false;
      try {
        const res = await fetch("/api/college/sections");
        if (res.ok) {
          const json = (await res.json()) as { sections?: { department?: string }[] };
          found = Array.from(
            new Set((json.sections ?? []).map((s) => (s.department ?? "").trim()).filter(Boolean))
          );
          ok = true;
        }
      } catch { /* filters fall back to showing nothing extra */ }
      // A failed read stays "not loaded" so nothing is decided from an empty list.
      if (alive) setState({ names: found, loaded: ok });
    })();
    return () => { alive = false; };
  }, []);

  return state;
}

export function useSectionDepartments(): string[] {
  return useSectionDepartmentState().names;
}
