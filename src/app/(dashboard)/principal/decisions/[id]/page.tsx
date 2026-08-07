"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Users,
  Star,
  Clock,
  Mail,
} from "lucide-react";
import type { HiringBatch, Candidate } from "@/types";

type PanelFeedbackItem = {
  id: string;
  candidateId: string;
  panelName: string;
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  ratings: { technicalKnowledge: number; communicationSkills: number; teachingMethodology: number };
  salaryNegotiated?: number;
  noticePeriod?: string;
  strengths?: string;
  weaknesses?: string;
  comments?: string;
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

const emptyHireTerms = { expectedSalary: "", negotiatedSalary: "", dateOfJoining: "" };

export default function PrincipalDecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [panelFeedback, setPanelFeedback] = useState<PanelFeedbackItem[]>([]);
  const [studentFeedback, setStudentFeedback] = useState<StudentFeedbackSummary[]>([]);
  const [offerLetterCandidateIds, setOfferLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Per-candidate decision state
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [hireTerms, setHireTerms] = useState<Record<string, { expectedSalary: string; negotiatedSalary: string; dateOfJoining: string }>>({});
  const [confirmFor, setConfirmFor] = useState<{ candidateId: string; action: "APPROVED" | "REJECTED" } | null>(null);
  const [isSaving, setIsSaving] = useState<string | null>(null);

  async function load() {
    try {
      const [batchRes, candidatesRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidates?batchId=${id}`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      ]);
      const b = batchRes.batch;
      setBatch(b);
      const cands = candidatesRes.candidates ?? [];
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
      for (const c of cands) {
        if (c.status === "APPROVED") pre[c.id] = { action: "APPROVED", remarks: "" };
        else if (c.status === "REJECTED") pre[c.id] = { action: "REJECTED", remarks: "" };
      }
      setDecisions(pre);
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

  async function applyDecision(candidateId: string, action: "APPROVED" | "REJECTED") {
    setIsSaving(candidateId);
    try {
      const remark = remarks[candidateId] ?? "";
      const stage = action === "APPROVED" ? "DECISION" : undefined;
      const terms = hireTerms[candidateId];

      const res = await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          ...(stage ? { stage } : {}),
          ...(action === "APPROVED" && terms ? {
            negotiatedSalary: Number(terms.negotiatedSalary),
            dateOfJoining: terms.dateOfJoining,
            ...(terms.expectedSalary ? { expectedSalary: Number(terms.expectedSalary) } : {}),
          } : {}),
        }),
      });
      if (!res.ok) throw new Error();

      setDecisions((prev) => ({ ...prev, [candidateId]: { action, remarks: remark } }));
      toast({
        variant: "success",
        title: action === "APPROVED" ? "Candidate approved" : "Candidate rejected",
        description: action === "APPROVED" ? "You can now send the offer letter." : "Candidate has been rejected.",
      });
      setConfirmFor(null);

      // Check if all candidates have decisions → mark batch COMPLETED
      const allDone = candidates.every(
        (c) => c.id === candidateId || decisions[c.id]
      );
      if (allDone) {
        await fetch(`/api/college/hiring-batches/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPhase: "COMPLETED", status: "COMPLETED" }),
        });
        toast({ title: "All decisions made", description: "Batch marked as completed." });
      }
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
          const pf = panelFeedback.filter((f) => f.candidateId === candidate.id);
          const sf = studentFeedback.find((f) => f.candidateId === candidate.id);
          const decision = decisions[candidate.id];

          const panelAccepts = pf.filter((f) => f.recommendation === "ACCEPT").length;
          const panelRejects = pf.filter((f) => f.recommendation === "REJECT").length;
          const panelMaybe = pf.filter((f) => f.recommendation === "MAYBE").length;

          const avgTechnical = avg(pf.map((f) => f.ratings.technicalKnowledge));
          const avgCommunication = avg(pf.map((f) => f.ratings.communicationSkills));
          const avgTeaching = avg(pf.map((f) => f.ratings.teachingMethodology));
          const panelOverall = avg([avgTechnical, avgCommunication, avgTeaching]);

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
                    {(() => {
                      const pfSalary = pf.find((f) => f.salaryNegotiated != null);
                      const salary = pfSalary?.salaryNegotiated;
                      const notice = pfSalary?.noticePeriod;
                      if (!salary) return null;
                      return (
                        <p className="text-sm font-medium text-primary mt-1">
                          Salary negotiated: ₹{salary.toLocaleString("en-IN")}/month
                          {notice ? ` · Notice: ${notice}` : ""}
                        </p>
                      );
                    })()}
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
                {/* Panel feedback summary */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Users className="h-3 w-3" />Panel Evaluation ({pf.length} member{pf.length !== 1 ? "s" : ""})
                    </p>
                    {pf.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No panel feedback yet</p>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Technical Knowledge</span>
                          <ScoreDots value={avgTechnical} />
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Communication</span>
                          <ScoreDots value={avgCommunication} />
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Teaching Methodology</span>
                          <ScoreDots value={avgTeaching} />
                        </div>
                        <div className="pt-1 border-t flex justify-between items-center text-sm font-medium">
                          <span>Panel Overall</span>
                          <div className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                            <span>{panelOverall.toFixed(1)} / 5</span>
                          </div>
                        </div>
                        <div className="flex gap-3 pt-1 text-xs">
                          <span className="flex items-center gap-1 text-green-600"><ThumbsUp className="h-3 w-3" />{panelAccepts} Accept</span>
                          <span className="flex items-center gap-1 text-amber-600"><Minus className="h-3 w-3" />{panelMaybe} Maybe</span>
                          <span className="flex items-center gap-1 text-red-600"><ThumbsDown className="h-3 w-3" />{panelRejects} Reject</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Student feedback summary */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Star className="h-3 w-3" />Student Feedback{sf ? ` (${sf.count} response${sf.count !== 1 ? "s" : ""})` : ""}
                    </p>
                    {!sf ? (
                      <p className="text-sm text-muted-foreground">No student feedback yet</p>
                    ) : (
                      <div className="space-y-1.5">
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
                        <div className="pt-1 border-t flex justify-between items-center text-sm font-medium">
                          <span>Avg Overall</span>
                          <div className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                            <span>{avg(Object.values(sf.averages)).toFixed(1)} / 5</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel member comments */}
                {pf.some((f) => f.strengths || f.weaknesses || f.comments) && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Panel Notes</p>
                    {pf.filter((f) => f.strengths || f.weaknesses || f.comments).map((f) => (
                      <div key={f.id} className="text-xs bg-muted/40 rounded-lg p-2 space-y-0.5">
                        <p className="font-medium">{f.panelName}</p>
                        {f.strengths && <p className="text-green-700">+ {f.strengths}</p>}
                        {f.weaknesses && <p className="text-red-700">− {f.weaknesses}</p>}
                        {f.comments && <p className="text-muted-foreground">{f.comments}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Decision area */}
                {decision ? (
                  decision.action === "APPROVED" ? (
                    <div className="pt-3 border-t flex items-center justify-between gap-3">
                      {offerLetterCandidateIds.has(candidate.id) ? (
                        <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4" />Offer letter sent
                        </span>
                      ) : (
                        <>
                          <span className="text-sm text-muted-foreground">Candidate approved.</span>
                          <Button size="sm" asChild>
                            <Link href={`/hod/offers/new?batchId=${batch.id}&candidateId=${candidate.id}`}>
                              <Mail className="h-3.5 w-3.5 mr-1.5" />
                              Send Offer Letter
                            </Link>
                          </Button>
                        </>
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
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Expected Salary (₹/yr)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={hireTerms[candidate.id]?.expectedSalary ?? ""}
                          onChange={(e) => setHireTerms((prev) => ({
                            ...prev,
                            [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], expectedSalary: e.target.value },
                          }))}
                          placeholder="e.g. 600000"
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Negotiated Salary (₹/yr) *</Label>
                        <Input
                          type="number"
                          min="0"
                          value={hireTerms[candidate.id]?.negotiatedSalary ?? ""}
                          onChange={(e) => setHireTerms((prev) => ({
                            ...prev,
                            [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], negotiatedSalary: e.target.value },
                          }))}
                          placeholder="e.g. 650000"
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Date of Joining *</Label>
                        <Input
                          type="date"
                          value={hireTerms[candidate.id]?.dateOfJoining ?? ""}
                          onChange={(e) => setHireTerms((prev) => ({
                            ...prev,
                            [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], dateOfJoining: e.target.value },
                          }))}
                          className="text-sm"
                        />
                      </div>
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
                      <Button
                        className="flex-1"
                        onClick={() => {
                          const terms = hireTerms[candidate.id];
                          if (!terms?.negotiatedSalary || !terms.dateOfJoining) {
                            toast({ variant: "destructive", title: "Enter negotiated salary and date of joining before approving" });
                            return;
                          }
                          setConfirmFor({ candidateId: candidate.id, action: "APPROVED" });
                        }}
                        disabled={!!isSaving}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => setConfirmFor({ candidateId: candidate.id, action: "REJECTED" })}
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
            ? "You'll be able to send the offer letter right after approving."
            : "This candidate will be marked as rejected. This action is final."
        }
        confirmLabel={confirmFor?.action === "APPROVED" ? "Yes, Approve" : "Yes, Reject"}
        variant={confirmFor?.action === "REJECTED" ? "destructive" : "default"}
        onConfirm={() => {
          if (confirmFor) void applyDecision(confirmFor.candidateId, confirmFor.action);
        }}
        loading={!!isSaving}
      />
    </div>
  );
}
