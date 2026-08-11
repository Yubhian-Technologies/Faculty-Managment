"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Step } from "@/components/shared/PipelineStep";
import { toast } from "@/hooks/useToast";
import { formatDate, toDate } from "@/lib/utils";
import {
  getCurrentStage,
  stateForStage,
  getApprovedDetailedStatuses,
  getOnboardingSummary,
  isHiringClosed,
  type PipelineStage,
} from "@/lib/hiringPipeline";
import { BATCH_PHASE_LABELS } from "@/types";
import type {
  VacancyRequest,
  CandidateApplication,
  CandidateStatus,
  CandidateStage,
  HiringBatch,
  OfferLetter,
  FacultyAccountRequestStatus,
} from "@/types";

// Same joined view HOD's pipeline board uses (src/app/(dashboard)/hod/pipeline/PipelineBoard.tsx)
// so both dashboards compute the exact same 5-stage stepper for a vacancy.
type PipelineCandidateView = {
  id: string;
  candidateId: string;
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

type OfferStatus = "SENT" | "ACCEPTED" | "REJECTED";

export default function CollegeOfficeDepartmentVacanciesPage() {
  const { department } = useParams<{ department: string }>();
  const decodedDepartment = decodeURIComponent(department);
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [offerStatusByCandidate, setOfferStatusByCandidate] = useState<Record<string, OfferStatus>>({});
  const [appointmentCandidateIds, setAppointmentCandidateIds] = useState<Set<string>>(new Set());
  const [accountRequestStatusByCandidate, setAccountRequestStatusByCandidate] = useState<Record<string, FacultyAccountRequestStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<"active" | "closed">("active");

  function load() {
    Promise.all([
      fetch("/api/college/vacancy-requests").then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>).then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>).then((d) => d.applications ?? []),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => d.batches ?? []),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).then((d) => d.letters ?? []),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).then((d) => d.letters ?? []).catch(() => []),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: { candidateId: string; status: FacultyAccountRequestStatus }[] }>).then((d) => d.requests ?? []).catch(() => []),
    ])
      .then(([vacancies, applications, batches, letters, appointmentLetters, accountRequests]) => {
        const offerMap: Record<string, OfferStatus> = {};
        for (const letter of letters) {
          if (letter.status === "REJECTED") continue;
          if (!offerMap[letter.candidateId]) offerMap[letter.candidateId] = letter.status as OfferStatus;
        }
        setOfferStatusByCandidate(offerMap);
        setAppointmentCandidateIds(new Set(appointmentLetters.map((l) => l.candidateId)));
        setAccountRequestStatusByCandidate(Object.fromEntries(accountRequests.map((r) => [r.candidateId, r.status])));

        const viewsByVacancy = new Map<string, PipelineCandidateView[]>();
        for (const a of applications) {
          const view: PipelineCandidateView = {
            id: a.id,
            candidateId: a.candidateId,
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
          .filter((v) => v.department === decodedDepartment)
          .map((v) => ({
            vacancy: v,
            candidates: viewsByVacancy.get(v.id) ?? [],
            batch: batches.find((b) => b.vacancyId === v.id && b.status !== "REJECTED") ?? null,
          }));
        built.sort((a, b) => (toDate(b.vacancy.createdAt)?.getTime() ?? 0) - (toDate(a.vacancy.createdAt)?.getTime() ?? 0));
        setEntries(built);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedDepartment]);

  function closedFor(e: PipelineEntry): boolean {
    const approvedCandidateIds = e.candidates.filter((c) => c.status === "APPROVED" && c.currentStage === "DECISION").map((c) => c.candidateId);
    return isHiringClosed(e.vacancy.status, e.batch?.currentPhase, approvedCandidateIds, accountRequestStatusByCandidate);
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        {[1, 2].map((i) => <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  const visible = entries.filter((e) => (scope === "closed" ? closedFor(e) : !closedFor(e)));

  return (
    <div className="space-y-6">
      <Link href="/college-office/documents" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Departments
      </Link>

      <div>
        <h1 className="text-xl font-bold">{decodedDepartment}</h1>
        <p className="text-sm text-muted-foreground">Offer letter → document verification & joining letter → appointment letter → credentials & official email setup</p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>Active</Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>Completed</Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-14 text-center">
          <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-semibold text-muted-foreground">
            {scope === "closed" ? "No past hirings yet" : "No active hiring requests in this department"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => (
            <DepartmentVacancyCard
              key={entry.vacancy.id}
              entry={entry}
              department={department}
              offerStatusByCandidate={offerStatusByCandidate}
              appointmentCandidateIds={appointmentCandidateIds}
              accountRequestStatusByCandidate={accountRequestStatusByCandidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentVacancyCard({
  entry,
  department,
  offerStatusByCandidate,
  appointmentCandidateIds,
  accountRequestStatusByCandidate,
}: {
  entry: PipelineEntry;
  department: string;
  offerStatusByCandidate: Record<string, OfferStatus>;
  appointmentCandidateIds: Set<string>;
  accountRequestStatusByCandidate: Record<string, FacultyAccountRequestStatus>;
}) {
  const { vacancy, candidates, batch } = entry;
  const currentStage = getCurrentStage(vacancy, batch);

  function stateFor(stage: PipelineStage) {
    return stateForStage(stage, currentStage);
  }

  const stage1Sub = vacancy.status === "APPROVED" ? "Approved ✓" : vacancy.status === "REJECTED" ? "Rejected" : "Pending approval";
  const stage2Sub = candidates.length === 0 ? "No candidates yet" : `${candidates.length} candidate${candidates.length !== 1 ? "s" : ""}`;
  const stage3Sub = batch ? BATCH_PHASE_LABELS[batch.currentPhase] : "Not started";
  const stage4Sub = batch?.currentPhase === "PRINCIPAL_FINAL_REVIEW" ? "Awaiting Principal's decision" : batch?.currentPhase === "COMPLETED" ? "Decision made" : "-";
  const stage5Sub =
    batch?.currentPhase === "COMPLETED"
      ? getOnboardingSummary(getApprovedDetailedStatuses(candidates, batch.currentPhase, offerStatusByCandidate, appointmentCandidateIds, accountRequestStatusByCandidate))
      : "-";

  const accentColor =
    vacancy.status === "REJECTED" ? "border-l-red-400" : batch?.currentPhase === "COMPLETED" ? "border-l-green-500" : vacancy.status === "APPROVED" ? "border-l-primary" : "border-l-amber-400";

  const readyForOffice = batch?.currentPhase === "COMPLETED";

  return (
    <div className={`rounded-xl border border-l-4 ${accentColor} bg-card shadow-sm overflow-hidden`}>
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold leading-snug">{vacancy.position}</h3>
              <StatusBadge status={vacancy.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Raised {formatDate(vacancy.createdAt)} · {vacancy.requiredCount} post{vacancy.requiredCount !== 1 ? "s" : ""} open
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
            #{vacancy.id.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>

      <div className="px-5 py-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-0 sm:gap-0">
          <Step step={1} label="Request" sub={stage1Sub} state={stateFor(1)} />
          <Step step={2} label="Candidates" sub={stage2Sub} state={stateFor(2)} />
          <Step step={3} label="Interview" sub={stage3Sub} state={stateFor(3)} />
          <Step step={4} label="Decision" sub={stage4Sub} state={stateFor(4)} />
          <Step step={5} label="Onboarding" sub={stage5Sub} state={stateFor(5)} isLast />
        </div>
      </div>

      <div className="px-5 pb-4 flex items-center justify-between gap-3 flex-wrap border-t pt-3">
        {readyForOffice ? (
          <Button size="sm" asChild>
            <Link href={`/college-office/documents/${department}/${vacancy.id}`}>Manage Candidates & Credentials →</Link>
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            Nothing for Office to action yet — still with HOD/Principal
          </span>
        )}
      </div>
    </div>
  );
}
