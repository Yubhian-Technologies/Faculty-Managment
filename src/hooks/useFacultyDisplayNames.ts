import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { readDisplayNameSettings, type DisplayNameSurfaceKey } from "@/lib/faculty/displayNameSettings";

// Settings > Website Display Name on screen: `nameFor(place, ids, usual)` is the faculty Display Name when the
// college ticked that place and the person has one, else `usual` - for DISPLAY only (a stored name is never
// changed). The names are fetched only while some place is ticked, so a college that ticked nothing pays nothing.
export interface FacultyNameIds { facultyId?: string; uid?: string }
export type NameFor = (place: DisplayNameSurfaceKey, ids: FacultyNameIds, usual: string) => string;

export function useFacultyDisplayNames(): { nameFor: NameFor; enabled: (place: DisplayNameSurfaceKey) => boolean } {
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const { collegeInfo } = useCollegeInfo();
  const surfaces = readDisplayNameSettings({ surfaces: collegeInfo?.displayNameSurfaces });
  const anyOn = Object.values(surfaces).some(Boolean);
  const { data } = useQuery({
    queryKey: ["faculty-display-names", collegeId],
    queryFn: async () => {
      const r = await fetch("/api/college/faculty-display-names");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { names?: Record<string, string> }).names ?? {};
    },
    enabled: Boolean(collegeId) && anyOn,
    refetchOnMount: "always",
  });
  const names = data ?? {};
  const enabled = useCallback((place: DisplayNameSurfaceKey) => surfaces[place] === true, [surfaces]);
  const nameFor: NameFor = useCallback(
    (place, ids, usual) => (surfaces[place] ? (ids.facultyId && names[ids.facultyId]) || (ids.uid && names[ids.uid]) || usual : usual),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- surfaces/names are rebuilt from collegeInfo/data each render
    [collegeInfo?.displayNameSurfaces, data],
  );
  return { nameFor, enabled };
}
