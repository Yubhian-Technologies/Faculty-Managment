"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Step, type StepState } from "@/components/shared/PipelineStep";
import { toast } from "@/hooks/useToast";
import { formatDate, toDate } from "@/lib/utils";
import {
  getDetailedHiringStatus,
  isHiringClosed,
  DETAILED_HIRING_STATUS_LABELS,
  type DetailedHiringStatus,
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

// Office's own 4-stage pipeline (Offer Letter -> Documents & Joining Letter ->
// Appointment Letter -> Credentials & Email), each bucketing several of the
// finer-grained DetailedHiringStatus values from hiringPipeline.ts - mirrors
// the visual stepper HOD/Principal get (src/components/shared/PipelineStep.tsx)
// but scoped to what Office actually does, instead of the Request/Candidates/
// Interview/Decision/Onboarding stepper which starts before Office is involved.
type OfficeStage = 1 | 2 | 3 | 4;

const OFFICE_STAGE_BY_STATUS: Record<DetailedHiringStatus, OfficeStage> = {
  INTERVIEW_COMPLETED: 1,
  SELECTED: 1,
  OFFER_PENDING: 1,
  OFFER_SENT: 1,
  CANDIDATE_ACCEPTANCE_PENDING: 1,
  OFFER_ACCEPTED: 2,
  DOCUMENTS_VERIFICATION: 2,
  JOINING_LETTER_UPLOADED: 2,
  APPOINTMENT_LETTER_PENDING: 3,
  APPOINTMENT_LETTER_SENT: 3,
  ACCOUNT_CREATION_PENDING: 4,
  CREDENTIALS_CREATED: 4,
  FACULTY_ONBOARDED: 4,
  HIRING_COMPLETED: 4,
};

const OFFICE_STAGE_LABELS: Record<OfficeStage, string> = {
  1: "Offer Letter",
  2: "Documents & Joining Letter",
  3: "Appointment Letter",
  4: "Credentials & Email",
};

// Ascending progress order - same declaration order as DETAILED_HIRING_STATUS_LABELS.
const DETAILED_STATUS_ORDER = Object.keys(DETAILED_HIRING_STATUS_LABELS) as DetailedHiringStatus[];

// Same joined view HOD's and Principal's pipeline boards use, trimmed to the
// fields getDetailedHiringStatus needs.
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

  // Office's own concern starts at the interview decision, not before - the
  // stepper below tracks the least-advanced decided candidate through Office's
  // 4 stages, same "least advanced wins" rule getOnboardingSummary used.
  const decidedCandidates = candidates.filter((c) => c.status === "APPROVED" && c.currentStage === "DECISION");
  const statuses = decidedCandidates.map((c) =>
    getDetailedHiringStatus({
      applicationStatus: c.status,
      currentStage: c.currentStage,
      batchPhase: batch?.currentPhase,
      notifiedPrincipalDocsReady: c.notifiedPrincipalDocsReady,
      joiningLetterUrl: c.joiningLetterUrl,
      offerStatus: offerStatusByCandidate[c.candidateId],
      appointmentLetterExists: appointmentCandidateIds.has(c.candidateId),
      accountRequestStatus: accountRequestStatusByCandidate[c.candidateId],
    })
  );
  const known = statuses.filter((s): s is DetailedHiringStatus => s !== null);
  const leastAdvanced = known.length > 0 ? DETAILED_STATUS_ORDER.find((s) => known.includes(s)) ?? null : null;
  const currentOfficeStage: OfficeStage = leastAdvanced ? OFFICE_STAGE_BY_STATUS[leastAdvanced] : 1;
  const leastAdvancedCount = leastAdvanced ? known.filter((s) => s === leastAdvanced).length : 0;

  function subFor(stage: OfficeStage): string {
    if (decidedCandidates.length === 0) {
      if (stage !== 1) return "-";
      if (vacancy.status !== "APPROVED") return "Awaiting Principal's approval of the request";
      if (!batch) return "Awaiting HOD to schedule interviews";
      if (batch.currentPhase === "COMPLETED") return "No candidates selected";
      return `In progress with HOD/Panel — ${BATCH_PHASE_LABELS[batch.currentPhase]}`;
    }
    if (stage < currentOfficeStage) return "Completed";
    if (stage > currentOfficeStage) return "-";
    if (!leastAdvanced) return "Awaiting offer letter";
    const label = DETAILED_HIRING_STATUS_LABELS[leastAdvanced];
    return decidedCandidates.length > 1 ? `${label} (${leastAdvancedCount}/${decidedCandidates.length})` : label;
  }

  function stateFor(stage: OfficeStage): StepState {
    if (stage < currentOfficeStage) return "done";
    if (stage === currentOfficeStage) return "current";
    return "upcoming";
  }

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
          <Step step={1} label={OFFICE_STAGE_LABELS[1]} sub={subFor(1)} state={stateFor(1)} />
          <Step step={2} label={OFFICE_STAGE_LABELS[2]} sub={subFor(2)} state={stateFor(2)} />
          <Step step={3} label={OFFICE_STAGE_LABELS[3]} sub={subFor(3)} state={stateFor(3)} />
          <Step step={4} label={OFFICE_STAGE_LABELS[4]} sub={subFor(4)} state={stateFor(4)} isLast />
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
