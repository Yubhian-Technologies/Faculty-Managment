"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Clock,
  GitBranch,
  XCircle,
  MapPin,
  Monitor,
  UserCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Step } from "@/components/shared/PipelineStep";
import { ShortlistDialog } from "@/components/hiring/ShortlistDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getCurrentStage, stateForStage, type PipelineStage } from "@/lib/hiringPipeline";
import { formatDate, toDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest, Candidate, CandidateApplication, CandidateStatus, CandidateStage, InterviewMode, HiringBatch, OfferLetter } from "@/types";
import { BATCH_PHASE_LABELS } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

// Joined view: application (per-hiring-request pipeline state) + candidate
// (person) fields. `id` is the applicationId; `candidateId` is the real
// Candidate id (used wherever offer/appointment letters key by candidate).
type PipelineCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  isShortlisted: boolean;
  interviewMode?: InterviewMode;
  bioDataSubmitted?: boolean;
  status: CandidateStatus;
  currentStage: CandidateStage;
};

type PipelineEntry = {
  vacancy: VacancyRequest;
  candidates: PipelineCandidateView[];
  batch: HiringBatch | null;
};

function isClosed(e: PipelineEntry): boolean {
  return e.vacancy.status === "REJECTED" || e.batch?.currentPhase === "COMPLETED";
}

type OfferStatus = "SENT" | "ACCEPTED" | "REJECTED";

// Once the Principal decides, the candidate's hiring status keeps moving through
// office/Principal-owned steps (offer → acceptance → appointment letter →
// webmaster login provisioning) that this dashboard has no action for — but it
// should still show where each one stands.
function candidateProgressLabel(
  candidate: PipelineCandidateView,
  offerStatusByCandidate: Record<string, OfferStatus>,
  appointmentCandidateIds: Set<string>,
  loginGeneratedCandidateIds: Set<string>
): string {
  if (loginGeneratedCandidateIds.has(candidate.candidateId)) return "Login Generated";
  if (appointmentCandidateIds.has(candidate.candidateId)) return "Appointment Letter Sent";
  const offerStatus = offerStatusByCandidate[candidate.candidateId];
  if (offerStatus === "ACCEPTED") return "Offer Accepted";
  if (offerStatus === "SENT") return "Offer Sent";
  return "Awaiting Offer Letter";
}

const PROGRESS_ORDER = ["Awaiting Offer Letter", "Offer Sent", "Offer Accepted", "Appointment Letter Sent", "Login Generated"];

function hiringResultsSummary(
  candidates: PipelineCandidateView[],
  offerStatusByCandidate: Record<string, OfferStatus>,
  appointmentCandidateIds: Set<string>,
  loginGeneratedCandidateIds: Set<string>
): string {
  const approved = candidates.filter((c) => c.status === "APPROVED" && c.currentStage === "DECISION");
  if (approved.length === 0) return "Awaiting hiring results";
  const labels = approved.map((c) => candidateProgressLabel(c, offerStatusByCandidate, appointmentCandidateIds, loginGeneratedCandidateIds));
  const counts = PROGRESS_ORDER.map((label) => labels.filter((l) => l === label).length);
  const leastAdvancedIdx = counts.findIndex((n) => n > 0);
  const label = PROGRESS_ORDER[leastAdvancedIdx];
  const count = counts[leastAdvancedIdx];
  return approved.length > 1 ? `${label} (${count}/${approved.length})` : label;
}

type NextAction = { label: string; href: string; disabled?: boolean; variant?: "default" | "outline" };

function getNextAction(
  entry: PipelineEntry,
  offerStatusByCandidate: Record<string, OfferStatus>,
  appointmentCandidateIds: Set<string>,
  loginGeneratedCandidateIds: Set<string>
): NextAction {
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
    return { label: "Add Candidates", href: "/hod/candidates" };
  }

  const p = batch.currentPhase;
  if (p === "PRINCIPAL_REVIEW") {
    return { label: "Awaiting Principal Approval", href: "#", disabled: true };
  }
  if (p === "HOD_FINAL_SETUP") {
    return { label: "Complete Interview Setup →", href: `/hod/batches/${batch.id}` };
  }
  if (p === "INTERVIEW_READY" || p === "IN_PROGRESS") {
    const sessionCandidates = candidates.filter((c) => (batch.applicationIds ?? []).includes(c.id));
    const pendingBioData = sessionCandidates.filter((c) => !c.bioDataSubmitted);
    if (pendingBioData.length > 0) {
      return {
        label: `Waiting on Bio Data (${pendingBioData.length} pending)`,
        href: "#",
        disabled: true,
      };
    }
    return { label: "Open Interview Session →", href: `/coordinator/${batch.id}` };
  }
  if (p === "PRINCIPAL_FINAL_REVIEW" || p === "COMPLETED") {
    // Offer letters, acceptance, and the appointment letter are all handled by
    // the office/Principal now — HOD has nothing left to do here but track status.
    return { label: hiringResultsSummary(candidates, offerStatusByCandidate, appointmentCandidateIds, loginGeneratedCandidateIds), href: "#", disabled: true };
  }
  return { label: "View Details", href: `/hod/batches/${batch.id}`, variant: "outline" };
}

// ─── Pipeline Card ────────────────────────────────────────────────────────────

function PipelineCard({
  entry,
  offerStatusByCandidate,
  appointmentCandidateIds,
  loginGeneratedCandidateIds,
  onDeleted,
  onRefresh,
}: {
  entry: PipelineEntry;
  offerStatusByCandidate: Record<string, OfferStatus>;
  appointmentCandidateIds: Set<string>;
  loginGeneratedCandidateIds: Set<string>;
  onDeleted: (vacancyId: string) => void;
  onRefresh: () => void;
}) {
  const { vacancy, candidates, batch } = entry;
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/vacancy-requests/${vacancy.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");
      toast({ variant: "success", title: "Hiring request deleted" });
      setDeleteConfirmOpen(false);
      onDeleted(vacancy.id);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to delete", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsDeleting(false);
    }
  }

  const currentStage = getCurrentStage(vacancy, batch);
  const shortlisted = candidates.filter((c) => c.isShortlisted).length;
  const nextAction = getNextAction(entry, offerStatusByCandidate, appointmentCandidateIds, loginGeneratedCandidateIds);

  function stateFor(stage: PipelineStage) {
    return stateForStage(stage, currentStage);
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
    batch?.currentPhase === "COMPLETED" || batch?.currentPhase === "PRINCIPAL_FINAL_REVIEW"
      ? hiringResultsSummary(candidates, offerStatusByCandidate, appointmentCandidateIds, loginGeneratedCandidateIds)
      : "-";

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
  const showShortlist = vacancy.status === "APPROVED" && !batch && candidates.length > 0;

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
              {vacancy.requiredCount}{" "}
              post{vacancy.requiredCount !== 1 ? "s" : ""} open
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            #{vacancy.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      {/* 4-step pipeline - vertical on mobile, horizontal on sm+ */}
      <div className="px-5 py-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-0 sm:gap-0">
          <Step step={1} label="Request" sub={stage1Sub} state={stateFor(1)} />
          <Step step={2} label="Candidates" sub={stage2Sub} state={stateFor(2)} />
          <Step step={3} label="Interview" sub={stage3Sub} state={stateFor(3)} />
          <Step step={4} label="Hiring Results" sub={stage4Sub} state={stateFor(4)} isLast />
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
              <Link href="/hod/candidates">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Candidate
              </Link>
            </Button>
          )}
          {showShortlist && (
            <Button size="sm" variant="outline" onClick={() => setShortlistOpen(true)}>
              <UserCheck className="h-3.5 w-3.5 mr-1" />
              Shortlist Candidates
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={isDeleting}
            onClick={() => setDeleteConfirmOpen(true)}
            className="text-destructive hover:text-destructive h-auto py-1 px-2"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
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
                      {(batch?.applicationIds ?? []).includes(c.id) && !c.bioDataSubmitted && (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 text-amber-700 bg-amber-100">
                          Bio Data Pending
                        </Badge>
                      )}
                      {c.status === "APPROVED" && c.currentStage === "DECISION" && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {candidateProgressLabel(c, offerStatusByCandidate, appointmentCandidateIds, loginGeneratedCandidateIds)}
                        </Badge>
                      )}
                      {c.status === "REJECTED" && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-red-700 border-red-300 bg-red-50">
                          Rejected
                        </Badge>
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

      <ShortlistDialog
        vacancyPosition={vacancy.position}
        candidates={candidates.map((c) => ({
          applicationId: c.id,
          name: c.name,
          email: c.email,
          isShortlisted: c.isShortlisted,
        }))}
        open={shortlistOpen}
        onOpenChange={setShortlistOpen}
        onSaved={onRefresh}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`Delete the hiring request for ${vacancy.position}?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function PipelineBoard({ scope }: { scope: "active" | "closed" }) {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [offerStatusByCandidate, setOfferStatusByCandidate] = useState<Record<string, OfferStatus>>({});
  const [appointmentCandidateIds, setAppointmentCandidateIds] = useState<Set<string>>(new Set());
  const [loginGeneratedCandidateIds, setLoginGeneratedCandidateIds] = useState<Set<string>>(new Set());
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
    ])
      .then(([vacancies, applications, candidates, batches, letters, appointmentLetters]) => {
        // Prefer a non-rejected offer per candidate — mirrors the office dashboard's logic.
        const offerMap: Record<string, OfferStatus> = {};
        for (const letter of letters) {
          if (letter.status === "REJECTED") continue;
          if (!offerMap[letter.candidateId]) offerMap[letter.candidateId] = letter.status as OfferStatus;
        }
        setOfferStatusByCandidate(offerMap);
        setAppointmentCandidateIds(new Set(appointmentLetters.map((l) => l.candidateId)));
        setLoginGeneratedCandidateIds(
          new Set(letters.filter((l) => l.credentialsFulfilledAt).map((l) => l.candidateId))
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
            bioDataSubmitted: person?.bioDataSubmitted,
            status: a.status,
            currentStage: a.currentStage,
          };
          const list = viewsByVacancy.get(a.vacancyRequestId);
          if (list) list.push(view);
          else viewsByVacancy.set(a.vacancyRequestId, [view]);
        }
        const built: PipelineEntry[] = vacancies.map((v) => ({
          vacancy: v,
          candidates: viewsByVacancy.get(v.id) ?? [],
          // A rejected proposal shouldn't block the HOD from starting a fresh
          // interview session for the same vacancy - treat it as no batch yet.
          batch: batches.find((b) => b.vacancyId === v.id && b.status !== "REJECTED") ?? null,
        }));
        built.sort(
          (a, b) => (toDate(b.vacancy.createdAt)?.getTime() ?? 0) - (toDate(a.vacancy.createdAt)?.getTime() ?? 0)
        );
        setEntries(built);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring pipeline" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // This is the primary HOD dashboard, likely to stay open longest through a
    // multi-actor pipeline — refetch on refocus so it doesn't go stale.
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <PipelineCard
          key={e.vacancy.id}
          entry={e}
          offerStatusByCandidate={offerStatusByCandidate}
          appointmentCandidateIds={appointmentCandidateIds}
          loginGeneratedCandidateIds={loginGeneratedCandidateIds}
          onDeleted={(vacancyId) => setEntries((prev) => prev.filter((entry) => entry.vacancy.id !== vacancyId))}
          onRefresh={load}
        />
      ))}
    </div>
  );
}
