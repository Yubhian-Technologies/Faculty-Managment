import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { LOCATION_SCOPED_ROLES } from "@/types";

export function useAssignedInterviews() {
  const user = useAuthStore((s) => s.user);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const role = user?.role;
    // Panel membership is a college-scoped concept — Super Admin and
    // location-scoped roles never have a collegeId, so this call would 401.
    if (!role || role === "SUPER_ADMIN" || LOCATION_SCOPED_ROLES.includes(role)) {
      setLoading(false);
      return;
    }

    // PANEL_MEMBER is already filtered server-side by their uid; all other
    // roles need the asPanelMember flag to see batches they've been added to.
    const url =
      role === "PANEL_MEMBER"
        ? "/api/college/hiring-batches"
        : "/api/college/hiring-batches?asPanelMember=true";

    fetch(url)
      .then((r) => r.json() as Promise<{ batches?: { currentPhase?: string }[] }>)
      .then((d) => {
        const batches = d.batches ?? [];
        if (role === "PANEL_MEMBER") {
          setCount(batches.length);
        } else {
          // For non-PANEL_MEMBER roles only show the nav when scoring is open
          const active = batches.filter(
            (b) =>
              b.currentPhase === "PANEL_INTERVIEW" ||
              b.currentPhase === "PRINCIPAL_FINAL_REVIEW"
          );
          setCount(active.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid]);

  return { hasInterviews: count > 0, interviewCount: count, loading };
}
