"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { College, Location } from "@/types";

/**
 * Shared admin data hooks — additive optimization for Batch 2.
 *
 * - Wraps `/api/admin/colleges` and `/api/admin/locations` with TanStack Query
 * - `staleTime: 5m` so repeated mounts (sidebar nav, dashboard, users, settings,
 *   audit-logs, colleges) share cache and avoid refetch storms.
 * - Keeps the same response shape `{ colleges }` / `{ locations }` — no API change.
 *
 * Adoption is intentionally incremental: only `super-admin/page.tsx` uses this
 * hook today as an example. Other pages remain on `fetch` to avoid mass churn.
 * New code should prefer these hooks; existing pages can be migrated one-by-one.
 *
 * Optional `?limit` is NOT applied here — dashboard needs the full list for
 * correct stats. Callers that want a projected/limited slice can pass a custom
 * `queryKey` suffix + `queryFn` or extend these hooks with an explicit `limit`
 * param (see colleges/locations GET `?limit` & `select()` — additive, defaults
 * to returning all when absent).
 */

type CollegesResponse = { colleges: College[] };
type LocationsResponse = { locations: Location[] };

async function fetchColleges(): Promise<College[]> {
  const res = await fetch("/api/admin/colleges");
  if (!res.ok) throw new Error("Failed to load colleges");
  const data = (await res.json()) as CollegesResponse;
  return data.colleges ?? [];
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch("/api/admin/locations");
  if (!res.ok) throw new Error("Failed to load locations");
  const data = (await res.json()) as LocationsResponse;
  return data.locations ?? [];
}

export function useAdminColleges(
  options?: Omit<UseQueryOptions<College[], Error>, "queryKey" | "queryFn">,
) {
  return useQuery<College[], Error>({
    queryKey: ["admin", "colleges"],
    queryFn: fetchColleges,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });
}

export function useAdminLocations(
  options?: Omit<UseQueryOptions<Location[], Error>, "queryKey" | "queryFn">,
) {
  return useQuery<Location[], Error>({
    queryKey: ["admin", "locations"],
    queryFn: fetchLocations,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });
}

/**
 * Convenience combined hook — dashboard often needs both lists.
 * Each list keeps its own cache entry; this just composes them.
 */
export function useAdminData() {
  const colleges = useAdminColleges();
  const locations = useAdminLocations();
  return { colleges, locations };
}
