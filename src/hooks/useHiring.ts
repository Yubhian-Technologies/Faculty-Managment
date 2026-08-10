"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  getVacancyRequests,
  getCandidates,
  getCandidateApplications,
  getHiringBatches,
  updateVacancyStatus,
  updateCandidate,
  createCandidateApplication,
  updateCandidateApplication,
  markCandidateApplicationArrived,
  updateHiringBatch,
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

export function useCandidates() {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["candidates", user?.collegeId],
    queryFn: () => getCandidates(user!.collegeId),
    enabled: !!user?.collegeId,
    select: (res) => res.data,
  });
}

export function useCandidateApplications(filters?: {
  status?: string;
  department?: string;
  candidateId?: string;
  vacancyRequestId?: string;
  batchId?: string;
  isShortlisted?: boolean;
}) {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["candidateApplications", user?.collegeId, filters],
    queryFn: () => getCandidateApplications(user!.collegeId, filters),
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

export function useCreateCandidateApplication() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof createCandidateApplication>[1]) =>
      createCandidateApplication(user!.collegeId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidateApplications"] }),
  });
}

export function useUpdateCandidateApplication() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      applicationId,
      data,
    }: {
      applicationId: string;
      data: Parameters<typeof updateCandidateApplication>[2];
    }) => updateCandidateApplication(user!.collegeId, applicationId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidateApplications"] }),
  });
}

export function useMarkCandidateApplicationArrived() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (applicationId: string) =>
      markCandidateApplicationArrived(user!.collegeId, applicationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidateApplications"] }),
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
