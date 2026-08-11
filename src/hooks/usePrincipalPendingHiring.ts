import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// Aggregate count of everything actually waiting on the Principal/Vice
// Principal across the whole hiring pipeline - vacancy requests, interview
// plans, hiring decisions, and appointment letters (Panel Scoring and
// Appointment Letters no longer have their own nav tabs, see navConfig.ts,
// so this is what the "Hiring Requests" tab's badge counts instead).
export function usePrincipalPendingHiring() {
  const user = useAuthStore((s) => s.user);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const role = user?.role;
    if (role !== "PRINCIPAL" && role !== "VICE_PRINCIPAL") {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch("/api/college/vacancy-requests").then((r) => r.json() as Promise<{ vacancyRequests?: { status?: string }[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches?: { currentPhase?: string }[] }>),
      fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications?: { candidateId?: string; documentVerification?: { notifiedPrincipalAt?: unknown } }[] }>),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters?: { candidateId?: string }[] }>).catch(() => ({ letters: [] })),
    ])
      .then(([vacanciesRes, batchesRes, applicationsRes, appointmentsRes]) => {
        const pendingVacancies = (vacanciesRes.vacancyRequests ?? []).filter((v) => v.status === "PENDING").length;
        const pendingInterviewPlans = (batchesRes.batches ?? []).filter((b) => b.currentPhase === "PRINCIPAL_REVIEW").length;
        const pendingDecisions = (batchesRes.batches ?? []).filter((b) => b.currentPhase === "PRINCIPAL_FINAL_REVIEW").length;

        const appointedIds = new Set((appointmentsRes.letters ?? []).map((l) => l.candidateId));
        const pendingAppointmentLetters = (applicationsRes.applications ?? []).filter(
          (a) => a.documentVerification?.notifiedPrincipalAt && a.candidateId && !appointedIds.has(a.candidateId)
        ).length;

        setCount(pendingVacancies + pendingInterviewPlans + pendingDecisions + pendingAppointmentLetters);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role]);

  return { pendingCount: count, loading };
}
