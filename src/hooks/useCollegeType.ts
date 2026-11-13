import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import type { CollegeType } from "@/types";

// Fetches the current session's college's `type` once - used to pick the
// right per-college-type designation/qualification lists (see
// src/lib/designations/config.ts) on Faculty/Supporting Staff/Vacancy
// Request forms. `undefined` while loading and for colleges with no type set
// (older records) - callers pass that straight through to the config
// helpers, which fall back to the Engineering-default lists for either case.
// Shared query: every component asking for it reads one request.
export function useCollegeType() {
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const { data, isLoading } = useQuery({
    queryKey: ["college-info-type", collegeId ?? ""],
    queryFn: async () => {
      const d = (await fetch("/api/college/info").then((r) => r.json())) as { type?: CollegeType };
      return { type: d.type };
    },
    enabled: !!collegeId,
    staleTime: 10 * 60_000,
  });
  return { collegeType: data?.type, loading: !!collegeId && isLoading };
}
