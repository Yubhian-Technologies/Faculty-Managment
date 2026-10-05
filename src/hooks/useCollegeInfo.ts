import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import type { CollegeType } from "@/types";

export interface CollegeInfo {
  name?: string;
  code?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  email?: string;
  type?: CollegeType;
  logoUrl?: string;
}

export function useCollegeInfo() {
  const collegeId = useAuthStore((s) => s.user?.collegeId);

  // College info rarely changes - the global query client's default
  // staleTime (2 min, see lib/queryClient.ts) means re-navigating between
  // pages within that window reuses this instead of re-fetching.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["college-info", collegeId],
    queryFn: async () => {
      const r = await fetch("/api/college/info");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as CollegeInfo & { error?: string };
      if (!d || typeof d !== "object" || "error" in d) throw new Error("invalid college info");
      return d;
    },
    enabled: Boolean(collegeId),
  });

  return { collegeInfo: data ?? null, loading: Boolean(collegeId) && isLoading, failed: isError };
}
