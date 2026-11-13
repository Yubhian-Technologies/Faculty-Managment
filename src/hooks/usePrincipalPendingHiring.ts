import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";

// Aggregate count of everything actually waiting on the Principal/Vice
// Principal across the whole hiring pipeline - vacancy requests, interview
// plans, hiring decisions, and appointment letters (Panel Scoring and
// Appointment Letters no longer have their own nav tabs, see navConfig.ts,
// so this is what the "Hiring Requests" tab's badge counts instead).
// One shared query: the sidebar, mobile drawer and bottom bar all show this badge and read the same answer.
async function loadPendingHiring(): Promise<number> {
  const [vacanciesRes, batchesRes, applicationsRes, appointmentsRes] = await Promise.all([
    fetch("/api/college/vacancy-requests").then((r) => r.json() as Promise<{ vacancyRequests?: { status?: string }[] }>),
    fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches?: { currentPhase?: string }[] }>),
    fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications?: { candidateId?: string; documentVerification?: { notifiedPrincipalAt?: unknown } }[] }>),
    fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters?: { candidateId?: string }[] }>).catch(() => ({ letters: [] as { candidateId?: string }[] })),
  ]);
  const pendingVacancies = (vacanciesRes.vacancyRequests ?? []).filter((v) => v.status === "PENDING").length;
  const pendingInterviewPlans = (batchesRes.batches ?? []).filter((b) => b.currentPhase === "PRINCIPAL_REVIEW").length;
  const pendingDecisions = (batchesRes.batches ?? []).filter((b) => b.currentPhase === "PRINCIPAL_FINAL_REVIEW").length;
  const appointedIds = new Set((appointmentsRes.letters ?? []).map((l) => l.candidateId));
  const pendingAppointmentLetters = (applicationsRes.applications ?? []).filter(
    (a) => a.documentVerification?.notifiedPrincipalAt && a.candidateId && !appointedIds.has(a.candidateId)
  ).length;
  return pendingVacancies + pendingInterviewPlans + pendingDecisions + pendingAppointmentLetters;
}

export function usePrincipalPendingHiring() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";
  const { data, isLoading } = useQuery({
    queryKey: ["nav", "principalPendingHiring", user?.uid ?? ""],
    queryFn: loadPendingHiring,
    enabled,
    staleTime: 60_000,
  });
  return { pendingCount: enabled ? data ?? 0 : 0, loading: enabled && isLoading };
}
