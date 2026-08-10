"use client";

import { CheckCircle2 } from "lucide-react";

export type StepState = "done" | "current" | "upcoming";

// One step in the 5-stage hiring pipeline stepper (Request → Candidates →
// Interview → Decision → Onboarding) - shared between HOD's pipeline board
// (hod/pipeline/PipelineBoard.tsx) and Principal's (principal/vacancies).
export function Step({
  step,
  label,
  sub,
  state,
  isLast,
}: {
  step: number;
  label: string;
  sub: string;
  state: StepState;
  isLast?: boolean;
}) {
  return (
    <div className="flex flex-1 items-start min-w-0">
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
            state === "done"
              ? "bg-green-500 border-green-500 text-white"
              : state === "current"
              ? "bg-primary border-primary text-white"
              : "bg-background border-border text-muted-foreground"
          }`}
        >
          {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : step}
        </div>
        {!isLast && (
          <div
            className={`w-0.5 flex-1 min-h-[1rem] mt-1 ${
              state === "done" ? "bg-green-300" : "bg-border"
            }`}
          />
        )}
      </div>
      <div className="ml-2.5 pb-3 min-w-0 flex-1">
        <p
          className={`text-xs font-semibold leading-tight truncate ${
            state === "done"
              ? "text-green-700"
              : state === "current"
              ? "text-primary"
              : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
        <p
          className={`text-[11px] leading-snug mt-0.5 ${
            state === "done"
              ? "text-green-600"
              : state === "current"
              ? "text-primary/70"
              : "text-muted-foreground/60"
          }`}
        >
          {sub}
        </p>
      </div>
      {!isLast && (
        <div className={`hidden sm:block self-start mt-3 mx-1 h-0.5 w-4 shrink-0 ${state === "done" ? "bg-green-300" : "bg-border"}`} />
      )}
    </div>
  );
}
