"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, KeyRound, ChevronRight, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { getDetailedHiringStatus, DETAILED_HIRING_STATUS_LABELS } from "@/lib/hiringPipeline";
import type { Candidate, CandidateApplication, OfferLetter, FacultyAccountRequest, FacultyAccountRequestStatus, VacancyRequest } from "@/types";

// Office joins person fields onto each application belonging to this one
// hiring request (vacancyRequestId) — `id` is the applicationId (this page's
// per-candidate detail route is keyed on it), `candidateId` is the real
// Candidate id (used wherever offer/appointment letters key on it).
// `statusLabel` comes from the exact same getDetailedHiringStatus() engine
// the HOD and Principal pipeline boards use, so badges match everywhere.
type DocCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  batchId?: string;
  statusLabel: string;
  eligibleForCredentialRequest: boolean;
  // Fully done - credentials created (or the whole request completed) - shown
  // as "Hiring Closed" instead of the raw status label, and routed to the
  // consolidated Candidate Profile (all-stages view) instead of the active
  // document-verification workflow page, which has nothing left to do here.
  isClosed: boolean;
};

function candidateHref(candidate: DocCandidateView): string {
  return candidate.isClosed
    ? `/candidate-profile/${candidate.candidateId}`
    : `/college-office/documents/candidate/${candidate.id}`;
}

export default function CollegeOfficeVacancyCandidatesPage() {
  const { department, vacancyId } = useParams<{ department: string; vacancyId: string }>();
  const router = useRouter();
  const [vacancy, setVacancy] = useState<VacancyRequest | null>(null);
  const [candidates, setCandidates] = useState<DocCandidateView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function offerKey(candidateId: string, batchId?: string) {
    return `${candidateId}::${batchId ?? ""}`;
  }

  function load() {
    Promise.all([
      fetch(`/api/college/vacancy-requests/${vacancyId}`).then((r) => r.json() as Promise<{ vacancyRequest?: VacancyRequest }>),
      fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string; batchId: string }[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([vacancyRes, appsRes, candsRes, offersRes, appointmentsRes, accountRequestsRes]) => {
        setVacancy(vacancyRes.vacancyRequest ?? null);

        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const scopedApps = (appsRes.applications ?? []).filter(
          (a) => a.vacancyRequestId === vacancyId && a.status !== "REJECTED" && a.currentStage === "DECISION"
        );
        const appointedKeys = new Set((appointmentsRes.letters ?? []).map((l) => `${l.candidateId}::${l.batchId}`));

        const offerMap: Record<string, OfferLetter> = {};
        for (const letter of offersRes.letters ?? []) {
          if (letter.status === "REJECTED") continue;
          const key = offerKey(letter.candidateId, letter.batchId);
          if (!offerMap[key]) offerMap[key] = letter;
        }
        const accountRequestByOfferId: Record<string, FacultyAccountRequestStatus> = Object.fromEntries(
          (accountRequestsRes.requests ?? []).map((r) => [r.offerId, r.status])
        );
        const accountRequestExistsByOfferId = new Set((accountRequestsRes.requests ?? []).map((r) => r.offerId));

        const views: DocCandidateView[] = scopedApps.map((a) => {
          const key = offerKey(a.candidateId, a.batchId);
          const offer = offerMap[key];
          const detailedStatus = getDetailedHiringStatus({
            applicationStatus: a.status,
            currentStage: a.currentStage,
            notifiedPrincipalDocsReady: !!a.documentVerification?.notifiedPrincipalAt,
            joiningLetterUrl: a.joiningLetterUrl,
            offerStatus: offer?.status as "SENT" | "ACCEPTED" | "REJECTED" | undefined,
            appointmentLetterExists: appointedKeys.has(key),
            accountRequestStatus: offer ? accountRequestByOfferId[offer.id] : undefined,
          });

          return {
            id: a.id,
            candidateId: a.candidateId,
            name: personMap.get(a.candidateId)?.name ?? "Unknown",
            batchId: a.batchId,
            statusLabel: detailedStatus ? DETAILED_HIRING_STATUS_LABELS[detailedStatus] : "In Progress",
            // Matches the eligibility gate in POST /api/college/faculty-account-requests:
            // appointment letter sent, joining date confirmed, no request yet.
            eligibleForCredentialRequest:
              detailedStatus === "APPOINTMENT_LETTER_SENT" &&
              !!offer?.candidateConfirmedJoiningDate &&
              !(offer && accountRequestExistsByOfferId.has(offer.id)),
            isClosed: detailedStatus === "CREDENTIALS_CREATED" || detailedStatus === "HIRING_COMPLETED",
          };
        });
        setCandidates(views);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring request" }))
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
  }, [vacancyId]);

  // Only one candidate to manage - skip straight to their action page instead
  // of making Office click through a one-row list first.
  useEffect(() => {
    if (!isLoading && candidates.length === 1) {
      router.replace(candidateHref(candidates[0]));
    }
  }, [isLoading, candidates, router]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const backHref = `/college-office/documents/${department}`;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hiring Request" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const selectedIds = candidates.filter((c) => selected.has(c.id) && c.eligibleForCredentialRequest).map((c) => c.id);

  return (
    <div className="space-y-6 pb-16">
      <Link href={backHref} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to {decodeURIComponent(department)}
      </Link>

      <PageHeader
        title={vacancy?.position ?? "Hiring Request"}
        description={`${vacancy?.department ?? decodeURIComponent(department)} · Offer letter → document verification & joining letter → appointment letter → credentials & official email setup`}
      />

      {candidates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No candidates reached the decision stage on this request yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
              {candidate.eligibleForCredentialRequest && (
                <Checkbox checked={selected.has(candidate.id)} onCheckedChange={() => toggleSelected(candidate.id)} />
              )}
              <Link
                href={candidateHref(candidate)}
                className="flex-1 min-w-0 flex items-center justify-between gap-3 group"
              >
                <p className="font-medium text-sm truncate">{candidate.name}</p>
                {candidate.isClosed ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Hiring Closed
                    </Badge>
                    <span className="text-xs text-primary group-hover:underline">View Details</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
                      {candidate.statusLabel}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                  </div>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10">
          <Button size="lg" className="shadow-lg" asChild>
            <Link href={`/college-office/settings/faculty-credentials?ids=${selectedIds.join(",")}`}>
              <KeyRound className="h-4 w-4 mr-2" />
              Request Faculty Accounts for {selectedIds.length} selected →
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
