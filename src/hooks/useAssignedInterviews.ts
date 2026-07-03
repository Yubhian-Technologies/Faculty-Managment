import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

export function useAssignedInterviews() {
  const user = useAuthStore((s) => s.user);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const role = user?.role;
    if (role !== "PANEL_MEMBER" && role !== "HOD") {
      setLoading(false);
      return;
    }
    const url =
      role === "HOD"
        ? "/api/college/hiring-batches?asPanelMember=true"
        : "/api/college/hiring-batches";

    fetch(url)
      .then((r) => r.json() as Promise<{ batches?: { currentPhase?: string }[] }>)
      .then((d) => {
        const batches = d.batches ?? [];
        if (role === "HOD") {
          // Only show nav item when panel scoring is actually open
          const active = batches.filter(
            (b) =>
              b.currentPhase === "PANEL_INTERVIEW" ||
              b.currentPhase === "PRINCIPAL_FINAL_REVIEW"
          );
          setCount(active.length);
        } else {
          setCount(batches.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid]);

  return { hasInterviews: count > 0, interviewCount: count, loading };
}
