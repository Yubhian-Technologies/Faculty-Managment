import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

export function useHiringActivity() {
  const role = useAuthStore((s) => s.user?.role);
  const [hasActivity, setHasActivity] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role !== "HOD") {
      setLoading(false);
      return;
    }
    fetch("/api/college/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests?: unknown[] }>)
      .then((d) => setHasActivity((d.vacancyRequests ?? []).length > 0))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [role]);

  return { hasActivity, loading };
}
