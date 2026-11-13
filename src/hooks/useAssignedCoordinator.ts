import { useAuthStore } from "@/store/authStore";
import { useHiringBatchesList } from "@/hooks/useHiringBatchesList";

// The hiring batch this panel member coordinates, while it is still before demo day.
// Shares the hiring-batches read with useAssignedInterviews (same URL for a panel member).
export function useAssignedCoordinator() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === "PANEL_MEMBER";
  const { data, isLoading } = useHiringBatchesList("/api/college/hiring-batches", user?.uid, enabled);
  const coordinatorBatch = enabled
    ? (data ?? []).find((b) => b.coordinatorUid === user?.uid && b.currentPhase === "INTERVIEW_READY") // only before demo day
    : undefined;
  return { coordinatorBatchId: coordinatorBatch?.id ?? null, loading: enabled && isLoading };
}
