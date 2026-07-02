import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { HiringBatch } from "@/types";

export function useAssignedCoordinator() {
  const user = useAuthStore((s) => s.user);
  const [coordinatorBatchId, setCoordinatorBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== "PANEL_MEMBER") {
      setLoading(false);
      return;
    }
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches?: (HiringBatch & { id: string })[] }>)
      .then((d) => {
        const coordinatorBatch = (d.batches ?? []).find(
          (b) =>
            b.coordinatorUid === user.uid &&
            (b.currentPhase === "INTERVIEW_READY" || b.currentPhase === "IN_PROGRESS") &&
            !b.demoComplete
        );
        setCoordinatorBatchId(coordinatorBatch?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid]);

  return { coordinatorBatchId, loading };
}
