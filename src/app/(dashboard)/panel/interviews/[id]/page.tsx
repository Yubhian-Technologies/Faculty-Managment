"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, Clock, Video } from "lucide-react";
import { MEETING_PLATFORM_LABELS } from "@/types";
import type { HiringBatch, Candidate, CandidateApplication } from "@/types";

// Joined view for the candidate list this panel member scores: person fields
// from Candidate, `id` = applicationId (list-key only), `candidateId` = the
// real Candidate id used in panel-feedback POSTs (that schema is unchanged).
type PanelCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
};

type MyFeedback = { candidateId: string; panelUid: string; panelScores?: unknown };

export default function PanelInterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const myUid = useAuthStore((s) => s.user?.uid);
  const role = useAuthStore((s) => s.user?.role);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<PanelCandidateView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [myFeedback, setMyFeedback] = useState<MyFeedback[]>([]);

  useEffect(() => {
    if (!myUid) return;
    function load() {
      Promise.all([
        fetch(`/api/college/hiring-batches/${id}`)
          .then((r) => r.json() as Promise<{ batch: HiringBatch }>)
          .then((d) => d.batch),
        fetch(`/api/college/panel-feedback?batchId=${id}`)
          .then((r) => r.json() as Promise<{ feedback: MyFeedback[] }>)
          // GET returns every panelist's feedback for non-PANEL_MEMBER roles (Principal/VP/HOD
          // included, since they're often panel members too) - only count MY OWN submissions,
          // otherwise another panelist scoring first would wrongly lock me out of scoring at all.
          .then((d) => d.feedback.filter((f) => f.panelUid === myUid)),
      ])
        .then(([b, mine]) => {
          setBatch(b);
          setMyFeedback(mine);
          if ((b.applicationIds ?? []).length > 0) {
            return Promise.all([
              fetch(`/api/college/candidate-applications?batchId=${id}`)
                .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
                .then((d) => d.applications ?? []),
              fetch(`/api/college/candidates`)
                .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
                .then((d) => d.candidates ?? []),
            ]).then(([applications, people]) => {
              const personMap = new Map(people.map((p) => [p.id, p]));
              setCandidates(
                applications.map((a) => {
                  const person = personMap.get(a.candidateId);
                  return {
                    id: a.id,
                    candidateId: a.candidateId,
                    name: person?.name ?? "Unknown",
                    email: person?.email ?? "",
                  };
                })
              );
            });
          }
        })
        .catch(() => toast({ variant: "destructive", title: "Failed to load interview" }))
        .finally(() => setIsLoading(false));
    }
    load();
    // The batch's phase (whether scoring is open yet) and demo-complete flag
    // change server-side (HOD/coordinator action) — refetch on refocus so this
    // page doesn't sit behind a stale "not open yet" snapshot.
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [id, myUid]);

  // The batch-owning HOD manages the full flow — per-panelist submission status
  // and "Submit All Evaluations to Principal" (plus their own scoring) — on their
  // batch page. Send them there instead of this thin per-scorer panel view. A
  // panelist HOD on another department's batch stays here and just scores.
  useEffect(() => {
    if (batch && role === "HOD" && batch.hodUid === myUid) {
      router.replace(`/hod/batches/${id}`);
    }
  }, [batch, role, myUid, id, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Interview" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  // Owning HOD is being redirected to their batch page (effect above) — don't
  // flash the panel scorer view.
  if (role === "HOD" && batch.hodUid === myUid) {
    return (
      <div className="space-y-6">
        <PageHeader title="Evaluations" description="Opening batch evaluations..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  // Scoring opens only once the HOD opens panel scoring (PANEL_INTERVIEW) —
  // not while the demo itself is still in progress (IN_PROGRESS).
  const canScore =
    batch.currentPhase === "PANEL_INTERVIEW" ||
    batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
    batch.currentPhase === "COMPLETED";

  // The meeting link only becomes visible once the HOD opens the interview
  // session (INTERVIEW_READY → IN_PROGRESS) - not before, so panel members
  // don't join before candidates are ready.
  const sessionOpen =
    batch.currentPhase === "IN_PROGRESS" ||
    batch.currentPhase === "PANEL_INTERVIEW" ||
    batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
    batch.currentPhase === "COMPLETED";

  const doneIds = new Set(
    myFeedback.filter((f) => f.panelScores != null).map((f) => f.candidateId)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch.position}
        description={`${batch.department} - ${formatDate(batch.interviewDate)}`}
      />

      {/* Batch Info */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          {batch.hiringMode === "ONLINE" ? (
            <>
              <div><p className="text-xs text-muted-foreground">Platform</p><p className="font-medium">{batch.meetingPlatform ? MEETING_PLATFORM_LABELS[batch.meetingPlatform] : "TBA"}</p></div>
              <div><p className="text-xs text-muted-foreground">Date & Time</p><p className="font-medium">{formatDate(batch.interviewDate)}{batch.interviewTime && <span className="ml-1 text-muted-foreground">{batch.interviewTime}</span>}</p></div>
            </>
          ) : (
            <>
              <div><p className="text-xs text-muted-foreground">Venue</p><p className="font-medium">{batch.interviewVenue || "TBA"}</p></div>
              <div><p className="text-xs text-muted-foreground">Date & Time</p><p className="font-medium">{formatDate(batch.interviewDate)}{batch.interviewTime && <span className="ml-1 text-muted-foreground">{batch.interviewTime}</span>}</p></div>
              <div><p className="text-xs text-muted-foreground">Demo Room</p><p className="font-medium">{batch.demoClassroom || "TBA"}</p></div>
            </>
          )}
          <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={batch.status} /></div>
        </CardContent>
      </Card>

      {batch.hiringMode === "ONLINE" && !sessionOpen && (
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            The meeting link will appear here once the HOD opens the interview session.
          </CardContent>
        </Card>
      )}

      {batch.hiringMode === "ONLINE" && sessionOpen && batch.meetingLink && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <Video className="h-4 w-4 shrink-0" />
              Join the meeting to interview each candidate before scoring.
            </div>
            <a
              href={batch.meetingLink}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary underline break-all"
            >
              {batch.meetingLink}
            </a>
          </CardContent>
        </Card>
      )}

      {/* Gate: batch must be set up before scoring */}
      {!canScore ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-2">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Scoring Not Yet Open</p>
            <p className="text-sm text-muted-foreground">
              Evaluation opens once the HOD opens panel scoring for this batch.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Candidates ({candidates.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates in this batch.</p>
            ) : (
              candidates.map((c) => {
                const done = doneIds.has(c.candidateId);
                const row = (
                  <div
                    className={`p-3 rounded-lg border transition-colors ${
                      done
                        ? "bg-green-50 border-green-200 cursor-default"
                        : "hover:bg-muted cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </div>
                      {done ? (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Submitted
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-xs">Rate</Badge>
                      )}
                    </div>
                  </div>
                );
                return done ? (
                  <div key={c.id}>{row}</div>
                ) : (
                  <Link key={c.id} href={`/evaluation/${id}/${c.candidateId}`}>
                    {row}
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {/* All submitted */}
      {canScore && doneIds.size === candidates.length && candidates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          You have submitted evaluations for all {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}.
        </div>
      )}
    </div>
  );
}
