import type { VacancyRequest, HiringBatch } from "@/types";
import type { StepState } from "@/components/shared/PipelineStep";

export type PipelineStage = 1 | 2 | 3 | 4;

// Which of the 4 stages (Request / Candidates / Interview / Hiring Results) a
// vacancy is currently at - shared by HOD's pipeline board and Principal's
// hiring requests view so both sides render the exact same stepper.
export function getCurrentStage(vacancy: VacancyRequest, batch: HiringBatch | null): PipelineStage {
  if (vacancy.status !== "APPROVED") return 1;
  if (!batch) return 2;
  if (batch.currentPhase === "COMPLETED" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW") return 4;
  return 3;
}

export function stateForStage(stage: PipelineStage, currentStage: PipelineStage): StepState {
  if (stage < currentStage) return "done";
  if (stage === currentStage) return "current";
  return "upcoming";
}
