import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function StepIndicator({ steps, currentStep, className }: StepIndicatorProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between relative">
        <div className="absolute top-4 left-0 right-0 h-0.5 bg-muted -z-0">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
          />
        </div>
        {steps.map((step, i) => {
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div key={i} className="flex flex-col items-center z-10">
              <div
                className={cn(
                  "h-8 w-8 rounded-full border-2 flex items-center justify-center text-sm font-semibold transition-colors",
                  isCompleted && "bg-primary border-primary text-primary-foreground",
                  isCurrent && "bg-background border-primary text-primary",
                  !isCompleted && !isCurrent && "bg-background border-muted text-muted-foreground"
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <div className="mt-2 text-center hidden sm:block">
                <p className={cn("text-xs font-medium", isCurrent ? "text-primary" : "text-muted-foreground")}>
                  {step.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-center sm:hidden">
        <p className="text-sm font-medium text-primary">
          Step {currentStep + 1} of {steps.length}: {steps[currentStep]?.label}
        </p>
      </div>
    </div>
  );
}
