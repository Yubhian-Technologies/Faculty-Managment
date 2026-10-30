import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";

// The designation printed beside a Class I/C name on timetables, fetched from the faculty data (see
// /api/college/faculty-designations). `ids` are Section.facultyInchargeUid values. Display only.
export function useFacultyDesignations(ids: (string | undefined)[]): (id?: string) => string {
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const key = Array.from(new Set(ids.filter((x): x is string => Boolean(x)))).sort().join(",");
  const { data } = useQuery({
    queryKey: ["faculty-designations", collegeId, key],
    queryFn: async () => {
      const r = await fetch(`/api/college/faculty-designations?ids=${encodeURIComponent(key)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { designations?: Record<string, string> }).designations ?? {};
    },
    enabled: Boolean(collegeId) && key.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  return (id) => (id && data?.[id]) || "";
}

/** "Mrs.M.SRILAKSHMI" + "Assistant Professor" -> "Mrs.M.SRILAKSHMI (Assistant Professor)"; the name alone when none is known. */
export function withDesignation(name: string, designation: string): string {
  return name && designation && !name.includes(`(${designation})`) ? `${name} (${designation})` : name;
}
