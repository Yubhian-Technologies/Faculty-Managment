import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { semesterPlan, type SemesterPlan, type TimingSemesters } from "@/lib/college/courseYears";

/**
 * A course's semesters and which year each belongs to, read from the course's OWN courseYearTimings
 * (the semesters Office/Principal configured per year) - see semesterPlan. Until timings load, or when a
 * course has none, the labelled fallback applies (durationYears x FALLBACK_SEMESTERS_PER_YEAR), i.e. what
 * these pages used to hard-code. No course yet = an empty plan.
 */
export function useCourseSemesterPlan(course: { id: string; durationYears?: number } | null | undefined): SemesterPlan {
  const courseId = course?.id ?? "";
  const { data } = useQuery({
    queryKey: ["course-year-timings-semesters", courseId],
    enabled: !!courseId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TimingSemesters[]> => {
      const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`);
      if (!res.ok) return [];
      const json = (await res.json()) as { timings?: TimingSemesters[] };
      return (json.timings ?? []).map((t) => ({ year: Number(t.year), semesters: t.semesters }));
    },
  });
  return useMemo(() => semesterPlan(course?.durationYears, data ?? []), [course?.durationYears, data]);
}
