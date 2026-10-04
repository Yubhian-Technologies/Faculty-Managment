"use client";

import { useCallback, useState } from "react";

// "Filters + Load": the controls edit a draft, and the list is fetched only when the person
// clicks Load. `applied` is what the last Load used - fetch effects depend on it, never on the
// live controls - and `dirty` says the controls have changed since, so the button can say so.
//
//   const { applied, dirty, load } = useAppliedFilters({ status, year });   // live values
//   useEffect(() => { fetchList(applied.status, applied.year); }, [applied]);
//   <LoadButton dirty={dirty} onClick={load} loading={loading} />
//
// The first `applied` equals the values at mount, so a page that already showed its default view on
// open still does; only later filter changes wait for Load.

export function sameFilters<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
}

export function useAppliedFilters<T extends Record<string, unknown>>(live: T) {
  const [applied, setApplied] = useState<T>(live);
  const dirty = !sameFilters(live, applied);
  // Always produces a new object so Load re-fetches even when nothing changed (a refresh).
  const load = useCallback(() => setApplied({ ...live }), [live]);
  return { applied, dirty, load };
}
