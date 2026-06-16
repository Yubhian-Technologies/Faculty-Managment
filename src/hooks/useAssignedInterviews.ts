import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

export function useAssignedInterviews() {
  const role = useAuthStore((s) => s.user?.role);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role !== "PANEL_MEMBER") {
      setLoading(false);
      return;
    }
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches?: unknown[] }>)
      .then((d) => setCount((d.batches ?? []).length))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [role]);

  return { hasInterviews: count > 0, interviewCount: count, loading };
}
