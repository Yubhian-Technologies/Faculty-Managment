import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import type { CollegeType } from "@/types";

export interface CollegeInfo {
  name?: string;
  code?: string;
  affiliation?: string;
  address?: string;
  /** The college's location city, printed beside the name on timetables. */
  city?: string;
  phone?: string;
  email?: string;
  type?: CollegeType;
  logoUrl?: string;
  hasCustomLogo?: boolean;
  rawLogoUrl?: string;
  /** Ticked timetable signature groups (Super Admin > Settings), one row of designations each. */
  timetableSignatureRows?: string[][];
  /** Ticked Teaching Load signature groups (Principal > Settings), one row of designations each. */
  teachingLoadSignatureRows?: string[][];
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
    // The signature rows can be changed in Settings at any time; a timetable
    // page opened afterwards must not print the old ones from the 2-minute cache.
    refetchOnMount: "always",
  });

  return { collegeInfo: data ?? null, loading: Boolean(collegeId) && isLoading, failed: isError };
}
