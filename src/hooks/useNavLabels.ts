import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";

// Menu labels that follow a college setting: in a college that prepares question papers (Exam Cell > Mid
// Configuration), the Mid Question Bank entries read "Mid Question Papers". One cached request; until it answers
// (or for roles that can't read it) the menu keeps its usual labels.

const MID_HREFS = ["/panel/mid-bank", "/hod/question-banks", "/exam-cell/question-banks"];

export function useNavLabels(): (href: string, label: string) => string {
  const user = useAuthStore((s) => s.user);
  const { data: papers } = useQuery({
    queryKey: ["mid-preparation", user?.collegeId],
    queryFn: () => fetch("/api/college/exam-mid-settings").then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { midPreparation?: string } } | null) => d?.settings?.midPreparation === "PAPERS").catch(() => false),
    enabled: !!user?.collegeId,
    staleTime: 10 * 60_000,
  });
  return (href, label) => (papers && MID_HREFS.includes(href) ? label.replace("Mid Question Bank", "Mid Question Papers") : label);
}
