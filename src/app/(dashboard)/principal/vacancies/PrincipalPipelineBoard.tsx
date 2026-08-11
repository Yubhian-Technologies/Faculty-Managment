"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Clock, GitBranch, XCircle, MapPin, Monitor, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Step } from "@/components/shared/PipelineStep";
import { getCurrentStage, stateForStage, getApprovedDetailedStatuses, getOnboardingSummary, getDetailedHiringStatus, isHiringClosed, DETAILED_HIRING_STATUS_LABELS, type PipelineStage } from "@/lib/hiringPipeline";
import { formatDate, toDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest, Candidate, CandidateApplication, CandidateStatus, CandidateStage, InterviewMode, HiringBatch, OfferLetter, FacultyAccountRequestStatus } from "@/types";
import { BATCH_PHASE_LABELS } from "@/types";

type OfferStatus = "SENT" | "ACCEPTED" | "REJECTED";

// Joined view: application (per-hiring-request pipeline state) + candidate
// (person) fields. `id` is the applicationId.
type PipelineCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  isShortlisted: boolean;
  interviewMode?: InterviewMode;
  status: CandidateStatus;
  currentStage: CandidateStage;
  notifiedPrincipalDocsReady?: boolean;
  joiningLetterUrl?: string;
};

type PipelineEntry = {
  vacancy: VacancyRequest;
  candidates: PipelineCandidateView[];
  batch: HiringBatch | null;
};

type NextAction = { label: string; href: string; disabled?: boolean; variant?: "default" | "outline" };

function getNextAction(entry: PipelineEntry): NextAction {
  const { vacancy, batch } = entry;

  if (vacancy.status === "PENDING") {
    return { label: "Review Request →", href: `/principal/vacancies/${vacancy.id}/approve` };
  }
  if (vacancy.status === "REJECTED") {
    return { label: "Request Rejected", href: "#", disabled: true };
  }
  if (!batch) {
    return { label: "Awaiting HOD to add candidates", href: "#", disabled: true };
  }

  const p = batch.currentPhase;
  if (p === "PRINCIPAL_REVIEW") {
    return { label: "Review Interview Plan →", href: `/principal/interviews/${batch.id}` };
  }
  if (p === "PRINCIPAL_FINAL_REVIEW") {
    return { label: "Make Decision →", href: `/principal/negotiate/${batch.id}` };
  }
  if (p === "COMPLETED") {
    return { label: "View Results", href: `/principal/decisions/${batch.id}`, variant: "outline" };
  }
  return { label: "Awaiting HOD / Panel", href: "#", disabled: true };
}

function PipelineCard({
  entry,
  offerStatusByCandidate,
  appointmentCandidateIds,
  accountRequestStatusByCandidate,
}: {
  entry: PipelineEntry;
  offerStatusByCandidate: Record<string, OfferStatus>;
  appointmentCandidateIds: Set<string>;
  accountRequestStatusByCandidate: Record<string, FacultyAccountRequestStatus>;
}) {
  const { vacancy, candidates, batch } = entry;
  const [expanded, setExpanded] = useState(false);

  const currentStage = getCurrentStage(vacancy, batch);
  const shortlisted = candidates.filter((c) => c.isShortlisted).length;
  const nextAction = getNextAction(entry);

  function stateFor(stage: PipelineStage) {
    return stateForStage(stage, currentStage);
  }

  const stage1Sub =
    vacancy.status === "APPROVED"
      ? "Approved ✓"
      : vacancy.status === "REJECTED"
      ? "Rejected"
      : "Awaiting your approval";

  const stage2Sub =
    candidates.length === 0
      ? "No candidates yet"
      : `${candidates.length} added · ${shortlisted} shortlisted`;

  const stage3Sub = batch ? BATCH_PHASE_LABELS[batch.currentPhase] : "Not started";

  const stage4Sub =
    batch?.currentPhase === "PRINCIPAL_FINAL_REVIEW"
      ? "Awaiting your decision"
      : batch?.currentPhase === "COMPLETED"
      ? "Decision made"
      : "-";

  const stage5Sub =
    batch?.currentPhase === "COMPLETED"
      ? getOnboardingSummary(getApprovedDetailedStatuses(candidates, batch.currentPhase, offerStatusByCandidate, appointmentCandidateIds, accountRequestStatusByCandidate))
      : "-";

  const accentColor =
    vacancy.status === "REJECTED"
      ? "border-l-red-400"
      : batch?.currentPhase === "COMPLETED"
      ? "border-l-green-500"
      : vacancy.status === "APPROVED"
      ? "border-l-primary"
      : "border-l-amber-400";

  return (
    <div className={`rounded-xl border border-l-4 ${accentColor} bg-card shadow-sm overflow-hidden`}>
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
              {vacancy.department} · {vacancy.hodName}
              {" · "}
              Raised {formatDate(vacancy.createdAt)}
              {" · "}
              {vacancy.requiredCount} post{vacancy.requiredCount !== 1 ? "s" : ""} open
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            #{vacancy.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      {/* 5-step pipeline - vertical on mobile, horizontal on sm+ */}
      <div className="px-5 py-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-0 sm:gap-0">
          <Step step={1} label="Request" sub={stage1Sub} state={stateFor(1)} />
          <Step step={2} label="Candidates" sub={stage2Sub} state={stateFor(2)} />
          <Step step={3} label="Interview" sub={stage3Sub} state={stateFor(3)} />
          <Step step={4} label="Decision" sub={stage4Sub} state={stateFor(4)} />
          <Step step={5} label="Onboarding" sub={stage5Sub} state={stateFor(5)} isLast />
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3 flex-wrap border-t pt-3">
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
        {vacancy.status === "PENDING" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" asChild>
              <Link href={`/principal/vacancies/${vacancy.id}/reject`}>Reject</Link>
            </Button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
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
                      {(() => {
                        const detailedStatus = getDetailedHiringStatus({
                          applicationStatus: c.status,
                          currentStage: c.currentStage,
                          batchPhase: batch?.currentPhase,
                          notifiedPrincipalDocsReady: c.notifiedPrincipalDocsReady,
                          joiningLetterUrl: c.joiningLetterUrl,
                          offerStatus: offerStatusByCandidate[c.candidateId],
                          appointmentLetterExists: appointmentCandidateIds.has(c.candidateId),
                          accountRequestStatus: accountRequestStatusByCandidate[c.candidateId],
                        });
                        return detailedStatus ? (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-blue-700 border-blue-300 bg-blue-50">
                            {DETAILED_HIRING_STATUS_LABELS[detailedStatus]}
                          </Badge>
                        ) : null;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                  <p className="font-medium">{batch.interviewVenue ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Demo Room</p>
                  <p className="font-medium">{batch.demoClassroom ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Coordinator</p>
                  <p className="font-medium">{batch.coordinatorName ?? "-"}</p>
                </div>
              </div>
            </div>
          )}

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

export function PrincipalPipelineBoard({ scope, department }: { scope: "active" | "closed"; department?: string }) {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [offerStatusByCandidate, setOfferStatusByCandidate] = useState<Record<string, OfferStatus>>({});
  const [appointmentCandidateIds, setAppointmentCandidateIds] = useState<Set<string>>(new Set());
  const [accountRequestStatusByCandidate, setAccountRequestStatusByCandidate] = useState<Record<string, FacultyAccountRequestStatus>>({});
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    void Promise.all([
      fetch("/api/college/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidate-applications")
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => d.applications ?? []),
      fetch("/api/college/candidates")
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? []),
      fetch("/api/college/offer-letters")
        .then((r) => r.json() as Promise<{ letters: OfferLetter[] }>)
        .then((d) => d.letters ?? []),
      fetch("/api/college/appointment-letters")
        .then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>)
        .then((d) => d.letters ?? [])
        .catch(() => []),
      fetch("/api/college/faculty-account-requests")
        .then((r) => r.json() as Promise<{ requests: { candidateId: string; status: FacultyAccountRequestStatus }[] }>)
        .then((d) => d.requests ?? [])
        .catch(() => []),
    ])
      .then(([vacancies, applications, candidates, batches, letters, appointmentLetters, accountRequests]) => {
        // Prefer a non-rejected offer per candidate — mirrors HOD's board.
        const offerMap: Record<string, OfferStatus> = {};
        for (const letter of letters) {
          if (letter.status === "REJECTED") continue;
          if (!offerMap[letter.candidateId]) offerMap[letter.candidateId] = letter.status as OfferStatus;
        }
        setOfferStatusByCandidate(offerMap);
        setAppointmentCandidateIds(new Set(appointmentLetters.map((l) => l.candidateId)));
        setAccountRequestStatusByCandidate(
          Object.fromEntries(accountRequests.map((r) => [r.candidateId, r.status]))
        );

        const candidateMap = new Map(candidates.map((c) => [c.id, c]));
        const viewsByVacancy = new Map<string, PipelineCandidateView[]>();
        for (const a of applications) {
          const person = candidateMap.get(a.candidateId);
          const view: PipelineCandidateView = {
            id: a.id,
            candidateId: a.candidateId,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            isShortlisted: a.isShortlisted,
            interviewMode: a.interviewMode,
            status: a.status,
            currentStage: a.currentStage,
            notifiedPrincipalDocsReady: !!a.documentVerification?.notifiedPrincipalAt,
            joiningLetterUrl: a.joiningLetterUrl,
          };
          const list = viewsByVacancy.get(a.vacancyRequestId);
          if (list) list.push(view);
          else viewsByVacancy.set(a.vacancyRequestId, [view]);
        }
        const built: PipelineEntry[] = vacancies
          .filter((v) => !department || v.department === department)
          .map((v) => ({
            vacancy: v,
            candidates: viewsByVacancy.get(v.id) ?? [],
            batch: batches.find((b) => b.vacancyId === v.id && b.status !== "REJECTED") ?? null,
          }));
        built.sort(
          (a, b) => (toDate(b.vacancy.createdAt)?.getTime() ?? 0) - (toDate(a.vacancy.createdAt)?.getTime() ?? 0)
        );
        setEntries(built);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // This is the primary Principal dashboard, likely to stay open longest
    // through a multi-actor pipeline — refetch on refocus so it doesn't go stale.
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);

  function closedFor(e: PipelineEntry): boolean {
    const approvedCandidateIds = e.candidates
      .filter((c) => c.status === "APPROVED" && c.currentStage === "DECISION")
      .map((c) => c.candidateId);
    return isHiringClosed(e.vacancy.status, e.batch?.currentPhase, approvedCandidateIds, accountRequestStatusByCandidate);
  }
  const visible = entries.filter((e) => (scope === "closed" ? closedFor(e) : !closedFor(e)));

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
            : "Requests submitted by HODs will show up here."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((e) => (
        <PipelineCard
          key={e.vacancy.id}
          entry={e}
          offerStatusByCandidate={offerStatusByCandidate}
          appointmentCandidateIds={appointmentCandidateIds}
          accountRequestStatusByCandidate={accountRequestStatusByCandidate}
        />
      ))}
    </div>
  );
}
