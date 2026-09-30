import type { ReactNode } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, CheckCircle2, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shared look of the Add Faculty wizard (hod/faculty/new): hero banner,
// numbered step pills, icon step header and Back/Next footer. Used by the
// Supporting Staff (Technical / Non-Technical) add pages and the Faculty edit
// page so all of them read the same as faculty creation.

export interface ChromeStep {
  key: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

export function WizardPage({ children }: { children: ReactNode }) {
  return <div className="max-w-5xl mx-auto space-y-6 pb-12">{children}</div>;
}

export function WizardHero({ icon: Icon, title, description, badge }: { icon: LucideIcon; title: string; description: string; badge?: string }) {
  return (
    <div className="rounded-2xl border bg-gradient-to-r from-card via-card to-primary/5 p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-2xs">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">{description}</p>
          </div>
        </div>
        {badge && <Badge variant="secondary" className="px-3 py-1 font-medium text-xs self-start sm:self-center">{badge}</Badge>}
      </div>
    </div>
  );
}

// `completedBefore` = index below which a step counts as done (wizard); omit
// for edit tabs, which have no order.
export function WizardStepper({ steps, currentKey, onSelect, errored, completedBefore }: {
  steps: ChromeStep[];
  currentKey: string;
  onSelect: (index: number) => void;
  errored?: Set<string>;
  completedBefore?: number;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
      {steps.map((s, i) => {
        const isError = errored?.has(s.key) ?? false;
        const isCurrent = s.key === currentKey;
        const isCompleted = completedBefore != null && i < completedBefore && !isError;
        return (
          <button
            type="button"
            key={s.key}
            onClick={() => onSelect(i)}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all shrink-0 border ${
              isError
                ? "border-destructive/50 bg-destructive/10 text-destructive ring-1 ring-destructive/30"
                : isCurrent
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : isCompleted
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                : "border-border/70 bg-card text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            }`}
          >
            <div
              className={`h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                isCurrent ? "bg-primary-foreground/20 text-primary-foreground" : isCompleted ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}
            >
              {isCompleted ? <Check className="h-3 w-3 stroke-[3]" /> : i + 1}
            </div>
            <span>{s.label}</span>
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}

export function WizardStepHeader({ step }: { step: ChromeStep }) {
  return (
    <CardHeader className="bg-card/60 border-b p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <step.icon className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-lg font-bold text-foreground">{step.label}</CardTitle>
          {step.description && <CardDescription className="text-xs text-muted-foreground mt-0.5">{step.description}</CardDescription>}
        </div>
      </div>
    </CardHeader>
  );
}

export function WizardFooter({ stepIndex, total, isLast, submitting, submitLabel, onBack, onNext }: {
  stepIndex: number;
  total: number;
  isLast: boolean;
  submitting: boolean;
  submitLabel: string;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-6 border-t border-border/60">
      <Button type="button" variant="outline" onClick={onBack} className="gap-2">
        <ChevronLeft className="h-4 w-4" />
        {stepIndex === 0 ? "Cancel" : "Back"}
      </Button>
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-muted-foreground hidden sm:inline">Step {stepIndex + 1} of {total}</span>
        {isLast ? (
          <Button type="submit" loading={submitting} className="gap-2 shadow-sm font-semibold px-6">
            <CheckCircle2 className="h-4 w-4" />
            {submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={onNext} className="gap-2 px-5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
