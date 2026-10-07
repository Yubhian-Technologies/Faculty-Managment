"use client";

import { useEffect, useState } from "react";

/**
 * The department names that at least one section is filed under, for the
 * Students / attendance-report filters.
 *
 * A department picker built from the department list alone offers choices that
 * can only come back empty: at one live college "Basic Science" carries no
 * sections and no students at all - its four sub-departments do the real work.
 * See lib/college/departmentSectionScope.ts for the rule this feeds.
 *
 * Deliberately best-effort and silent: this only decides which options a filter
 * shows, so a failed read leaves the caller with an empty list rather than an
 * error toast on top of whatever the page is already reporting.
 */
export function useSectionDepartments(): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        if (!res.ok) return;
        const json = (await res.json()) as { sections?: { department?: string }[] };
        const found = Array.from(
          new Set((json.sections ?? []).map((s) => (s.department ?? "").trim()).filter(Boolean))
        );
        if (alive) setNames(found);
      } catch { /* filters fall back to showing nothing extra */ }
    })();
    return () => { alive = false; };
  }, []);

  return names;
}
