"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Clock,
  GitBranch,
  CheckCircle2,
  XCircle,
  MapPin,
  Monitor,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate, toDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest, Candidate, HiringBatch, OfferLetter } from "@/types";
import { BATCH_PHASE_LABELS } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineEntry = {
  vacancy: VacancyRequest;
  candidates: Candidate[];
  batch: HiringBatch | null;
};

type StepState = "done" | "current" | "upcoming";
type PipelineStage = 1 | 2 | 3 | 4;

function isClosed(e: PipelineEntry): boolean {
  return e.vacancy.status === "REJECTED" || e.batch?.currentPhase === "COMPLETED";
}

// ─── Stage helpers ────────────────────────────────────────────────────────────

function getCurrentStage(vacancy: VacancyRequest, batch: HiringBatch | null): PipelineStage {
  if (vacancy.status !== "APPROVED") return 1;
  if (!batch) return 2;
  if (batch.currentPhase === "COMPLETED" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW") return 4;
  return 3;
}

type NextAction = { label: string; href: string; disabled?: boolean; variant?: "default" | "outline" };

function getNextAction(entry: PipelineEntry, sentCandidateIds: Set<string>): NextAction {
  const { vacancy, candidates, batch } = entry;

  if (vacancy.status === "PENDING") {
    return { label: "Awaiting Principal Approval", href: "#", disabled: true };
  }
  if (vacancy.status === "REJECTED") {
    return { label: "Request Rejected", href: "#", disabled: true };
  }

  if (!batch) {
    const shortlisted = candidates.filter((c) => c.isShortlisted).length;
    if (shortlisted >= 1) {
      return { label: "Create Interview Session →", href: `/hod/batches/new?vacancyId=${vacancy.id}` };
    }
    return { label: "Add Candidates", href: `/hod/candidates/new?vacancyId=${vacancy.id}` };
  }

  const p = batch.currentPhase;
  if (p === "PRINCIPAL_REVIEW") {
    return { label: "Awaiting Principal Approval", href: "#", disabled: true };
  }
  if (p === "HOD_FINAL_SETUP") {
    return { label: "Complete Interview Setup →", href: `/hod/batches/${batch.id}` };
  }
  if (p === "INTERVIEW_READY" || p === "IN_PROGRESS") {
    return { label: "Open Interview Session →", href: `/coordinator/${batch.id}` };
  }
  if (p === "PRINCIPAL_FINAL_REVIEW" || p === "COMPLETED") {
    const pendingOffer = candidates.some(
      (c) => c.currentStage === "DECISION" && !sentCandidateIds.has(c.id)
    );
    if (pendingOffer) {
      return { label: "Send Offer Letter →", href: `/hod/offers/new?batchId=${batch.id}` };
    }
    if (candidates.some((c) => sentCandidateIds.has(c.id))) {
      return { label: "View Offer Letter", href: "/hod/offers", variant: "outline" };
    }
    if (p === "PRINCIPAL_FINAL_REVIEW") {
      return { label: "Awaiting Final Decision", href: "#", disabled: true };
    }
    return { label: "View Results", href: `/hod/batches/${batch.id}`, variant: "outline" };
  }
  return { label: "View Details", href: `/hod/batches/${batch.id}`, variant: "outline" };
}

// ─── Step Component ───────────────────────────────────────────────────────────

function Step({
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

// ─── Pipeline Card ────────────────────────────────────────────────────────────

function PipelineCard({ entry, sentCandidateIds }: { entry: PipelineEntry; sentCandidateIds: Set<string> }) {
  const { vacancy, candidates, batch } = entry;
  const [expanded, setExpanded] = useState(false);

  const currentStage = getCurrentStage(vacancy, batch);
  const shortlisted = candidates.filter((c) => c.isShortlisted).length;
  const nextAction = getNextAction(entry, sentCandidateIds);

  function stateFor(stage: PipelineStage): StepState {
    if (stage < currentStage) return "done";
    if (stage === currentStage) return "current";
    return "upcoming";
  }

  const stage1Sub =
    vacancy.status === "APPROVED"
      ? "Approved ✓"
      : vacancy.status === "REJECTED"
      ? "Rejected"
      : "Pending approval";

  const stage2Sub =
    candidates.length === 0
      ? "No candidates yet"
      : `${candidates.length} added · ${shortlisted} shortlisted`;

  const stage3Sub = batch
    ? BATCH_PHASE_LABELS[batch.currentPhase]
    : "Not started";

  const stage4Sub =
    batch?.currentPhase === "COMPLETED"
      ? "Process complete"
      : batch?.currentPhase === "PRINCIPAL_FINAL_REVIEW"
      ? "Awaiting decision"
      : "—";

  const accentColor =
    vacancy.status === "REJECTED"
      ? "border-l-red-400"
      : batch?.currentPhase === "COMPLETED"
      ? "border-l-green-500"
      : vacancy.status === "APPROVED"
      ? "border-l-primary"
      : "border-l-amber-400";

  // Only show secondary Add Candidate button when the primary action is something else
  // (i.e. when there are already shortlisted candidates and primary = "Create Interview Session")
  const showAddCandidate = vacancy.status === "APPROVED" && !batch && shortlisted >= 1;

  return (
    <div className={`rounded-xl border border-l-4 ${accentColor} bg-card shadow-sm overflow-hidden`}>
      {/* Top header */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold leading-snug">{vacancy.position}</h3>
              <StatusBadge status={vacancy.status} />
              {batch && (
                <span className="text-[11px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                  {BATCH_PHASE_LABELS[batch.currentPhase]}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {vacancy.department}
              {" · "}
              Raised {formatDate(vacancy.createdAt)}
              {" · "}
              {vacancy.availableCount ?? vacancy.requiredCount}{" "}
              post{(vacancy.availableCount ?? vacancy.requiredCount) !== 1 ? "s" : ""} open
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            #{vacancy.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      {/* 4-step pipeline — vertical on mobile, horizontal on sm+ */}
      <div className="px-5 py-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-0 sm:gap-0">
          <Step step={1} label="Request" sub={stage1Sub} state={stateFor(1)} />
          <Step step={2} label="Candidates" sub={stage2Sub} state={stateFor(2)} />
          <Step step={3} label="Interview" sub={stage3Sub} state={stateFor(3)} />
          <Step step={4} label="Decision" sub={stage4Sub} state={stateFor(4)} isLast />
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3 flex-wrap border-t pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          {nextAction.disabled ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              {nextAction.label}
            </span>
          ) : (
            <Button size="sm" variant={nextAction.variant ?? "default"} asChild>
              <Link href={nextAction.href}>{nextAction.label}</Link>
            </Button>
          )}
          {showAddCandidate && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/hod/candidates/new?vacancyId=${vacancy.id}`}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Candidate
              </Link>
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="h-4 w-4" /> Hide details</>
          ) : (
            <><ChevronDown className="h-4 w-4" /> Show details</>
          )}
        </button>
      </div>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="border-t bg-muted/20 px-5 py-4 space-y-5">
          {/* Candidates */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Candidates ({candidates.length})
            </p>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No candidates linked to this request yet.</p>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg bg-background border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground text-xs ml-2 truncate">{c.email}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.interviewMode === "ONLINE" ? (
                        <Monitor className="h-3.5 w-3.5 text-blue-500" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 text-gray-500" />
                      )}
                      {c.isShortlisted ? (
                        <Badge variant="default" className="text-[10px] py-0 px-1.5">
                          <UserCheck className="h-3 w-3 mr-0.5" /> Shortlisted
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Added</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Interview session details */}
          {batch && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Interview Session
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm bg-background border rounded-lg p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-medium">{formatDate(batch.interviewDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Venue</p>
                  <p className="font-medium">{batch.interviewVenue ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Demo Room</p>
                  <p className="font-medium">{batch.demoClassroom ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Coordinator</p>
                  <p className="font-medium">{batch.coordinatorName ?? "—"}</p>
                </div>
              </div>
              <div className="mt-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/hod/batches/${batch.id}`}>Open Full Session Details →</Link>
                </Button>
              </div>
            </div>
          )}

          {/* Rejection note */}
          {vacancy.status === "REJECTED" && vacancy.principalResponse?.reason && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2 text-sm">
              <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-700">Rejection Reason</p>
                <p className="text-red-600">{vacancy.principalResponse.reason}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function PipelineBoard({ scope }: { scope: "active" | "closed" }) {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [sentCandidateIds, setSentCandidateIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/college/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidates")
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? []),
      fetch("/api/college/offer-letters")
        .then((r) => r.json() as Promise<{ letters: OfferLetter[] }>)
        .then((d) => d.letters ?? []),
    ])
      .then(([vacancies, candidates, batches, letters]) => {
        setSentCandidateIds(new Set(letters.map((l) => l.candidateId)));
        const built: PipelineEntry[] = vacancies.map((v) => ({
          vacancy: v,
          candidates: candidates.filter(
            (c) => c.vacancyId === v.id || (!c.vacancyId && c.position === v.position && c.department === v.department)
          ),
          batch: batches.find((b) => b.vacancyId === v.id) ?? null,
        }));
        built.sort(
          (a, b) => (toDate(b.vacancy.createdAt)?.getTime() ?? 0) - (toDate(a.vacancy.createdAt)?.getTime() ?? 0)
        );
        setEntries(built);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring pipeline" }))
      .finally(() => setIsLoading(false));
  }, []);

  const visible = entries.filter((e) => (scope === "closed" ? isClosed(e) : !isClosed(e)));

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-44 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-14 text-center">
        <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
        <p className="font-semibold text-muted-foreground">
          {scope === "closed" ? "No past hirings yet" : "No hiring requests yet"}
        </p>
        <p className="text-sm text-muted-foreground/60 mt-1">
          {scope === "closed"
            ? "Completed and rejected requests will show up here."
            : "Create a hiring request to start the process"}
        </p>
        {scope === "active" && (
          <Button className="mt-4" asChild>
            <Link href="/hod/vacancy/new">Create Hiring Request</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((e) => (
        <PipelineCard key={e.vacancy.id} entry={e} sentCandidateIds={sentCandidateIds} />
      ))}
    </div>
  );
}
