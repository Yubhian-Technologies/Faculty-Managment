"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  getVacancyRequests,
  getCandidates,
  getHiringBatches,
  updateVacancyStatus,
  updateCandidate,
  updateHiringBatch,
  markCandidateArrived,
} from "@/lib/firestore/hiring";
import type { WorkflowStatus } from "@/types";

export function useVacancyRequests(filters?: { status?: WorkflowStatus; department?: string }) {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["vacancies", user?.collegeId, filters],
    queryFn: () => getVacancyRequests(user!.collegeId, filters),
    enabled: !!user?.collegeId,
    select: (res) => res.data,
  });
}

export function useCandidates(filters?: {
  status?: string;
  department?: string;
  batchId?: string;
  isShortlisted?: boolean;
}) {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["candidates", user?.collegeId, filters],
    queryFn: () => getCandidates(user!.collegeId, filters),
    enabled: !!user?.collegeId,
    select: (res) => res.data,
  });
}

export function useHiringBatches(filters?: { status?: WorkflowStatus; hodUid?: string }) {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["hiringBatches", user?.collegeId, filters],
    queryFn: () => getHiringBatches(user!.collegeId, filters),
    enabled: !!user?.collegeId,
    select: (res) => res.data,
  });
}

export function useUpdateVacancyStatus() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      vacancyId,
      status,
      response,
    }: {
      vacancyId: string;
      status: WorkflowStatus;
      response?: Parameters<typeof updateVacancyStatus>[3];
    }) => updateVacancyStatus(user!.collegeId, vacancyId, status, response),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vacancies"] }),
  });
}

export function useMarkCandidateArrived() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (candidateId: string) =>
      markCandidateArrived(user!.collegeId, candidateId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidates"] }),
  });
}

export function useUpdateCandidate() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      candidateId,
      data,
    }: {
      candidateId: string;
      data: Parameters<typeof updateCandidate>[2];
    }) => updateCandidate(user!.collegeId, candidateId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidates"] }),
  });
}

export function useUpdateHiringBatch() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      batchId,
      data,
    }: {
      batchId: string;
      data: Parameters<typeof updateHiringBatch>[2];
    }) => updateHiringBatch(user!.collegeId, batchId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiringBatches"] }),
  });
}
