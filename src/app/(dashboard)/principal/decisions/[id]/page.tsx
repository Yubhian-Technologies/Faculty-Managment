"use client";

import { use, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Star,
  Clock,
  Mail,
  PenLine,
} from "lucide-react";
import type { HiringBatch, Candidate, CandidateApplication } from "@/types";

// Joined view: application (per-hiring-request decision state) + candidate
// (person) fields. `id` is the applicationId (used for PATCHes to
// candidate-applications); `candidateId` is the real Candidate id.
type DecisionCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  negotiatedSalary?: number;
  dateOfJoining?: string;
  termsAndConditions?: string[];
  committeeRecommendation?: string;
  bioData?: Candidate["bioData"];
};

type PanelFeedbackItem = {
  id: string;
  candidateId: string;
  panelName: string;
  panelScores?: Record<string, number>;
  strengths?: string;
  weaknesses?: string;
  comments?: string;
};

const PANEL_CRITERIA: [string, string][] = [
  ["subjectKnowledge", "Subject Knowledge"],
  ["presentationSkills", "Presentation Skills"],
  ["research", "Research"],
  ["specificAttributes", "Specific Attributes"],
  ["others", "Others"],
];

const RESEARCH_PROFILE_LABELS: Record<string, string> = {
  firstAuthorPublications: "Publications (first/corresponding author)",
  publicationsQ1OrHighIF: "Publications in Q1 or IF > 4.0",
  reviewPublications: "Review Publications",
  totalPublicationsInclCoAuthor: "Total Publications (incl. co-author)",
  patentsPublished: "Patents Published",
  patentsGranted: "Patents Granted",
  hIndex: "H-Index",
  i10Index: "i10-Index",
  fundingReceived: "Funding Projects Received",
  fundingApplied: "Funding Projects Applied",
  nationalExposure: "National Exposure",
  internationalExposure: "International Exposure",
  keyResearchSkills: "Key Research Skills",
};

type StudentFeedbackSummary = {
  candidateId: string;
  count: number;
  averages: Record<string, number>;
};

type Decision = { action: "APPROVED" | "REJECTED"; remarks: string };

function ScoreDots({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full ${i < Math.round(value) ? "bg-primary" : "bg-muted-foreground/20"}`} />
      ))}
      <span className="text-xs text-muted-foreground ml-1">{value.toFixed(1)}</span>
    </div>
  );
}

function avg(vals: number[]) {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function PrincipalDecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<DecisionCandidateView[]>([]);
  const [panelFeedback, setPanelFeedback] = useState<PanelFeedbackItem[]>([]);
  const [studentFeedback, setStudentFeedback] = useState<StudentFeedbackSummary[]>([]);
  const [offerLetterCandidateIds, setOfferLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Per-candidate decision state
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [committeeRecs, setCommitteeRecs] = useState<Record<string, string>>({});
  const [confirmFor, setConfirmFor] = useState<{ applicationId: string; action: "APPROVED" | "REJECTED" } | null>(null);
  const [isSaving, setIsSaving] = useState<string | null>(null);

  async function load() {
    try {
      const [batchRes, applicationsRes, candidatesRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidate-applications?batchId=${id}`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch(`/api/college/candidates`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      ]);
      const b = batchRes.batch;
      setBatch(b);
      const candidateMap = new Map((candidatesRes.candidates ?? []).map((c) => [c.id, c]));
      const cands: DecisionCandidateView[] = (applicationsRes.applications ?? []).map((a) => {
        const person = candidateMap.get(a.candidateId);
        return {
          id: a.id,
          candidateId: a.candidateId,
          name: person?.name ?? "Unknown",
          email: person?.email ?? "",
          phone: person?.phone ?? "",
          status: a.status,
          negotiatedSalary: a.negotiatedSalary,
          dateOfJoining: a.dateOfJoining,
          termsAndConditions: a.termsAndConditions,
          committeeRecommendation: a.committeeRecommendation,
          bioData: person?.bioData,
        };
      });
      setCandidates(cands);

      const [pfRes, sfRes, olRes] = await Promise.all([
        fetch(`/api/college/panel-feedback?batchId=${id}`)
          .then((r) => r.json() as Promise<{ feedback: PanelFeedbackItem[] }>)
          .then((d) => d.feedback ?? []),
        fetch(`/api/college/student-feedback?batchId=${id}`)
          .then((r) => r.json() as Promise<{ feedback: { candidateId: string; ratings: Record<string, number> }[] }>)
          .then((d) => d.feedback ?? []),
        fetch(`/api/college/offer-letters?batchId=${id}`)
          .then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>)
          .then((d) => d.letters ?? [])
          .catch(() => []),
      ]);
      setPanelFeedback(pfRes);
      setOfferLetterCandidateIds(new Set(olRes.map((l) => l.candidateId)));

      // Aggregate student feedback by candidate
      const summaryMap: Record<string, { count: number; sums: Record<string, number> }> = {};
      for (const sf of sfRes) {
        if (!summaryMap[sf.candidateId]) summaryMap[sf.candidateId] = { count: 0, sums: {} };
        summaryMap[sf.candidateId].count++;
        for (const [k, v] of Object.entries(sf.ratings)) {
          summaryMap[sf.candidateId].sums[k] = (summaryMap[sf.candidateId].sums[k] ?? 0) + v;
        }
      }
      setStudentFeedback(
        Object.entries(summaryMap).map(([candidateId, { count, sums }]) => ({
          candidateId,
          count,
          averages: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / count])),
        }))
      );

      // Pre-populate already-made decisions from candidate status
      const pre: Record<string, Decision> = {};
      const recs: Record<string, string> = {};
      for (const c of cands) {
        if (c.status === "APPROVED") pre[c.id] = { action: "APPROVED", remarks: "" };
        else if (c.status === "REJECTED") pre[c.id] = { action: "REJECTED", remarks: "" };
        if (c.committeeRecommendation) recs[c.id] = c.committeeRecommendation;
      }
      setDecisions(pre);
      setCommitteeRecs(recs);
    } catch {
      toast({ variant: "destructive", title: "Failed to load batch" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  // Batch phase can change server-side (HOD submits for review) while this tab
  // sits open — refetch on refocus so Approve/Reject doesn't stay stuck behind
  // a stale "Scoring in progress" snapshot.
  useEffect(() => {
    function onFocus() { void load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function applyDecision(applicationId: string, action: "APPROVED" | "REJECTED") {
    setIsSaving(applicationId);
    try {
      const remark = remarks[applicationId] ?? "";
      const stage = action === "APPROVED" ? "DECISION" : undefined;

      // Negotiated salary, date of joining, and terms & conditions are captured
      // earlier on /principal/negotiate/[id] — this step only records the decision.
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          ...(stage ? { stage } : {}),
          committeeRecommendation: committeeRecs[applicationId] ?? "",
        }),
      });
      if (!res.ok) throw new Error();

      setDecisions((prev) => ({ ...prev, [applicationId]: { action, remarks: remark } }));
      toast({
        variant: "success",
        title: action === "APPROVED" ? "Candidate approved" : "Candidate rejected",
        description: action === "APPROVED" ? "Office notified to issue offer letter." : "Candidate has been rejected.",
      });
      setConfirmFor(null);
      // Batch auto-completion (once every candidate has a decision) is handled
      // authoritatively server-side in this same PATCH — see candidates/[id]/route.ts.
    } catch {
      toast({ variant: "destructive", title: "Failed to save decision" });
    } finally {
      setIsSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Final Decision" description="Loading..." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Batch not found</div>;

  const allDecided = candidates.length > 0 && candidates.every((c) => decisions[c.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Final Decision: ${batch.position}`}
        description={`${batch.department} · ${formatDate(batch.interviewDate)} · ${candidates.length} candidate${candidates.length !== 1 ? "s" : ""}`}
      />

      {allDecided && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All decisions submitted. Approved candidates have been moved to Document Verification.
        </div>
      )}

      <div className="space-y-4">
        {candidates.map((candidate) => {
          const pf = panelFeedback.filter((f) => f.candidateId === candidate.candidateId);
          const sf = studentFeedback.find((f) => f.candidateId === candidate.candidateId);
          const decision = decisions[candidate.id];

          const panelPf = pf.filter((f) => f.panelScores);
          const panelCriteriaAverages = PANEL_CRITERIA.map(([key]) =>
            avg(panelPf.map((f) => f.panelScores![key]).filter((v) => v != null))
          );
          const panelOverallAvg = avg(panelCriteriaAverages.filter((v) => v > 0));

          const researchProfile = candidate.bioData?.researchProfile;
          const researchEntries = researchProfile
            ? Object.entries(researchProfile).filter(([, v]) => v)
            : [];

          return (
            <Card
              key={candidate.id}
              className={
                decision?.action === "APPROVED"
                  ? "border-green-200 bg-green-50/20"
                  : decision?.action === "REJECTED"
                  ? "border-red-200 bg-red-50/20"
                  : ""
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{candidate.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{candidate.email} · {candidate.phone}</p>
                  </div>
                  {decision ? (
                    <Badge
                      variant="outline"
                      className={
                        decision.action === "APPROVED"
                          ? "text-green-700 border-green-300 bg-green-50"
                          : "text-red-700 border-red-300 bg-red-50"
                      }
                    >
                      {decision.action === "APPROVED" ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" />Approved</>
                      ) : (
                        <><XCircle className="h-3 w-3 mr-1" />Rejected</>
                      )}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Panel evaluation summary */}
                {panelPf.length > 0 && (
                  <div className="space-y-2 pb-2 border-b">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Panel Evaluation ({panelPf.length} panelist{panelPf.length !== 1 ? "s" : ""})
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {PANEL_CRITERIA.map(([key, label], i) => (
                        <div key={key} className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">{label}</span>
                          <ScoreDots value={panelCriteriaAverages[i]} max={10} />
                        </div>
                      ))}
                    </div>
                    <div className="pt-1 flex justify-between items-center text-sm font-medium">
                      <span>Overall (avg)</span>
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                        <span>{panelOverallAvg.toFixed(1)} / 10</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Student feedback summary */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Star className="h-3 w-3" />Student Feedback{sf ? ` (${sf.count} response${sf.count !== 1 ? "s" : ""})` : ""}
                  </p>
                  {!sf ? (
                    <p className="text-sm text-muted-foreground">No student feedback yet</p>
                  ) : (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {(
                        [
                          ["clarity", "Clarity"],
                          ["engagement", "Engagement"],
                          ["knowledgeDepth", "Knowledge"],
                          ["timeManagement", "Time Mgmt"],
                          ["overallImpression", "Overall"],
                        ] as [string, string][]
                      ).map(([key, label]) => (
                        <div key={key} className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">{label}</span>
                          <ScoreDots value={sf.averages[key] ?? 0} />
                        </div>
                      ))}
                      <div className="pt-1 border-t flex justify-between items-center text-sm font-medium sm:col-span-2">
                        <span>Avg Overall</span>
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                          <span>{avg(Object.values(sf.averages)).toFixed(1)} / 5</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Research profile (self-reported by candidate) */}
                {researchEntries.length > 0 && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Research Profile</p>
                    <div className="grid gap-1 sm:grid-cols-2 text-xs">
                      {researchEntries.map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{RESEARCH_PROFILE_LABELS[key] ?? key}</span>
                          <span className="font-medium text-right">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Panel member notes */}
                {panelPf.some((f) => f.strengths || f.weaknesses || f.comments) && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Panel Notes</p>
                    {panelPf
                      .filter((f) => f.strengths || f.weaknesses || f.comments)
                      .map((f) => (
                        <div key={f.id} className="text-xs bg-muted/40 rounded-lg p-2 space-y-1">
                          <p className="font-medium">{f.panelName}</p>
                          {f.strengths && <p className="text-muted-foreground"><span className="font-medium text-foreground">Strengths:</span> {f.strengths}</p>}
                          {f.weaknesses && <p className="text-muted-foreground"><span className="font-medium text-foreground">Weaknesses:</span> {f.weaknesses}</p>}
                          {f.comments && <p className="text-muted-foreground"><span className="font-medium text-foreground">Comments:</span> {f.comments}</p>}
                        </div>
                      ))}
                  </div>
                )}

                {/* Recruiting committee recommendation */}
                <div className="space-y-1.5 pt-2 border-t">
                  <Label className="text-xs">Recruiting Committee Recommendation (optional)</Label>
                  <Textarea
                    value={committeeRecs[candidate.id] ?? ""}
                    onChange={(e) => setCommitteeRecs((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                    placeholder="Written recommendation of the recruiting committee..."
                    rows={2}
                    className="text-sm"
                  />
                </div>

                {/* Decision area */}
                {decision ? (
                  decision.action === "APPROVED" ? (
                    <div className="pt-3 border-t flex items-center justify-between gap-3">
                      {offerLetterCandidateIds.has(candidate.candidateId) ? (
                        <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4" />Offer letter sent
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          Candidate approved — awaiting the office to send the offer letter.
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="pt-3 border-t text-sm text-muted-foreground">Candidate rejected.</div>
                  )
                ) : batch.currentPhase !== "PRINCIPAL_FINAL_REVIEW" ? (
                  <div className="pt-3 border-t text-sm text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Scoring in progress — decisions open once the HOD submits this batch for final review.
                  </div>
                ) : (
                  <div className="pt-3 border-t space-y-3">
                    <div className="flex items-start justify-between gap-3 rounded-lg border p-3 bg-muted/20">
                      <div className="space-y-1 text-sm">
                        {candidate.negotiatedSalary != null && candidate.dateOfJoining ? (
                          <>
                            <p><span className="text-muted-foreground">Negotiated Salary:</span> <strong>₹{candidate.negotiatedSalary.toLocaleString("en-IN")}/yr</strong></p>
                            <p><span className="text-muted-foreground">Date of Joining:</span> <strong>{formatDate(new Date(candidate.dateOfJoining))}</strong></p>
                            {candidate.termsAndConditions && candidate.termsAndConditions.length > 0 && (
                              <p className="text-muted-foreground">{candidate.termsAndConditions.length} term{candidate.termsAndConditions.length !== 1 ? "s" : ""} & conditions attached</p>
                            )}
                          </>
                        ) : (
                          <p className="text-amber-700">Negotiated salary and date of joining haven&apos;t been entered yet.</p>
                        )}
                      </div>
                      <Button size="sm" variant="outline" asChild className="shrink-0">
                        <Link href={`/principal/negotiate/${id}`}>
                          <PenLine className="h-3.5 w-3.5 mr-1.5" />
                          {candidate.negotiatedSalary != null ? "Edit Terms" : "Enter Terms"}
                        </Link>
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Remarks (optional)</Label>
                      <Textarea
                        value={remarks[candidate.id] ?? ""}
                        onChange={(e) => setRemarks((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                        placeholder="Add remarks for this decision..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      {(() => {
                        const todayStr = new Date().toISOString().split("T")[0];
                        const isTermsValid = candidate.negotiatedSalary != null && candidate.negotiatedSalary > 0 && candidate.dateOfJoining && candidate.dateOfJoining >= todayStr;
                        return (
                          <Button
                            className="flex-1"
                            onClick={() => {
                              if (!isTermsValid) {
                                toast({ variant: "destructive", title: "Enter a valid negotiated salary and future date of joining before approving" });
                                return;
                              }
                              setConfirmFor({ applicationId: candidate.id, action: "APPROVED" });
                            }}
                            disabled={!!isSaving || !isTermsValid}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1.5" />
                            Approve
                          </Button>
                        );
                      })()}
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => setConfirmFor({ applicationId: candidate.id, action: "REJECTED" })}
                        disabled={!!isSaving}
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirmFor}
        onOpenChange={(open) => { if (!open) setConfirmFor(null); }}
        title={confirmFor?.action === "APPROVED" ? "Approve this candidate?" : "Reject this candidate?"}
        description={
          confirmFor?.action === "APPROVED"
            ? "Once approved, the office will be notified to release the offer letter."
            : "This candidate will be marked as rejected. This action is final."
        }
        confirmLabel={confirmFor?.action === "APPROVED" ? "Yes, Approve" : "Yes, Reject"}
        variant={confirmFor?.action === "REJECTED" ? "destructive" : "default"}
        onConfirm={() => {
          if (confirmFor) void applyDecision(confirmFor.applicationId, confirmFor.action);
        }}
        loading={!!isSaving}
      />
    </div>
  );
}
