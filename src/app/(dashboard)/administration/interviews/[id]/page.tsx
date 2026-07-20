"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { InterviewScoringFields, ScoreFormValues, EMPTY_SCORES, ScoringKey, calcPanelScore, calcStudentScore, isPanelFilled, isStudentFilled } from "@/components/shared/InterviewScoringFields";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface InterviewFeedback {
  id: string;
  panelUid: string;
  panelName: string;
  panelRole: string;
  candidateId: string;
  candidateName: string;
  subjectKnowledge: number;
  teachingMethodology: number;
  communicationSkills: number;
  researchProfile: number;
  professionalism: number;
  studentSubjectKnowledge: number;
  studentClarityOfTeaching: number;
  studentCommunication: number;
  studentClassroomResources: number;
  studentOverallEffectiveness: number;
  panelScore: number;
  studentScore: number;
  overallScore: number;
  remarks: string;
  recommendation: string;
}

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  notes?: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: { id: string; name: string }[];
  shortlistedCandidateIds: string[];
  status: string;
  callLetterSent: boolean;
  createdByName: string;
  approvedByName?: string;
}

type Recommendation = "SELECTED" | "WAITLISTED" | "REJECTED";

interface ScoreForm extends ScoreFormValues {
  recommendation: Recommendation | "";
  remarks: string;
}

const EMPTY_FORM: ScoreForm = { ...EMPTY_SCORES, recommendation: "", remarks: "" };

const RECOMMENDATION_OPTIONS: { value: Recommendation; label: string; color: string; ring: string }[] = [
  { value: "SELECTED",   label: "Select",   color: "border-green-400 text-green-700 bg-green-50 hover:bg-green-100",  ring: "ring-green-400" },
  { value: "WAITLISTED", label: "Waitlist", color: "border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100",  ring: "ring-amber-400" },
  { value: "REJECTED",   label: "Reject",   color: "border-red-400 text-red-700 bg-red-50 hover:bg-red-100",          ring: "ring-red-400" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATION: "Administration",
  HR_ADMIN: "HR Admin",
  LOCATION_DEPT_HEAD: "Dept Head",
};

export default function AdminInterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const myUid = useAuthStore((s) => s.user?.uid ?? "");

  const [interview, setInterview] = useState<LocationInterview | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [approveOpen, setApproveOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [scoreForms, setScoreForms] = useState<Record<string, ScoreForm>>({});
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetch(`/api/location/interviews/${id}`)
      .then((r) => r.json() as Promise<{ interview: LocationInterview; feedback: InterviewFeedback[] }>)
      .then((d) => {
        setInterview(d.interview);
        const fb = d.feedback ?? [];
        setFeedback(fb);

        const pre: Record<string, ScoreForm> = {};
        for (const f of fb.filter((f) => f.panelUid === myUid)) {
          pre[f.candidateId] = {
            subjectKnowledge: f.subjectKnowledge ?? 0,
            teachingMethodology: f.teachingMethodology ?? 0,
            communicationSkills: f.communicationSkills ?? 0,
            researchProfile: f.researchProfile ?? 0,
            professionalism: f.professionalism ?? 0,
            studentSubjectKnowledge: f.studentSubjectKnowledge ?? 0,
            studentClarityOfTeaching: f.studentClarityOfTeaching ?? 0,
            studentCommunication: f.studentCommunication ?? 0,
            studentClassroomResources: f.studentClassroomResources ?? 0,
            studentOverallEffectiveness: f.studentOverallEffectiveness ?? 0,
            remarks: f.remarks,
            recommendation: f.recommendation as Recommendation,
          };
        }
        setScoreForms(pre);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  function updateForm(candidateId: string, patch: Partial<ScoreForm>) {
    setScoreForms((prev) => ({ ...prev, [candidateId]: { ...EMPTY_FORM, ...prev[candidateId], ...patch } }));
  }

  async function handleApproveReject(action: "APPROVE") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/location/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Interview Plan Approved",
        description: "HR Admin has been notified.",
      });
      setApproveOpen(false);
      load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionLoading(false);
    }
  }

  async function submitScore(candidateId: string, candidateName: string) {
    const form = scoreForms[candidateId] ?? EMPTY_FORM;
    if (!isPanelFilled(form) || !isStudentFilled(form) || !form.recommendation) {
      toast({ variant: "destructive", title: "Fill all criteria (1–5) and choose a recommendation" });
      return;
    }
    setSubmittingFor(candidateId);
    try {
      const res = await fetch(`/api/location/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_FEEDBACK",
          candidateId,
          candidateName,
          subjectKnowledge: form.subjectKnowledge,
          teachingMethodology: form.teachingMethodology,
          communicationSkills: form.communicationSkills,
          researchProfile: form.researchProfile,
          professionalism: form.professionalism,
          studentSubjectKnowledge: form.studentSubjectKnowledge,
          studentClarityOfTeaching: form.studentClarityOfTeaching,
          studentCommunication: form.studentCommunication,
          studentClassroomResources: form.studentClassroomResources,
          studentOverallEffectiveness: form.studentOverallEffectiveness,
          remarks: form.remarks,
          recommendation: form.recommendation,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Score submitted", description: `Feedback saved for ${candidateName}` });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to submit score" });
    } finally {
      setSubmittingFor(null);
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading...</div>;
  if (!interview) return <div className="text-sm text-destructive p-6">Interview not found.</div>;

  const isPending = interview.status === "PENDING_ADMIN";
  const canScore = interview.status === "APPROVED" || interview.status === "COMPLETED";

  const feedbackByCandidate = feedback.reduce<Record<string, InterviewFeedback[]>>((acc, f) => {
    if (!acc[f.candidateId]) acc[f.candidateId] = [];
    acc[f.candidateId].push(f);
    return acc;
  }, {});
  const myFeedbackByCandidate = feedback
    .filter((f) => f.panelUid === myUid)
    .reduce<Record<string, InterviewFeedback>>((acc, f) => { acc[f.candidateId] = f; return acc; }, {});
  const allScored = (interview.candidatesInfo ?? []).length > 0 &&
    (interview.candidatesInfo ?? []).every((c) => myFeedbackByCandidate[c.id]);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={interview.title}
        description={`Submitted by ${interview.createdByName}`}
        actions={
          isPending ? (
            <div className="flex gap-2">
              <Button onClick={() => setApproveOpen(true)}>Approve</Button>
              <Button variant="destructive" onClick={() => router.push(`/administration/interviews/${id}/reject`)}>Reject</Button>
            </div>
          ) : undefined
        }
      />

      {/* Interview info */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Interview Info</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Status</p><StatusBadge status={interview.status} /></div>
          <div><p className="text-muted-foreground">Date</p><p>{formatDate(interview.interviewDate as Parameters<typeof formatDate>[0])}</p></div>
          <div><p className="text-muted-foreground">Venue</p><p>{interview.venue}</p></div>
          <div><p className="text-muted-foreground">Call Letters</p><p>{interview.callLetterSent ? "Sent" : "Not yet sent"}</p></div>
          {interview.approvedByName && <div><p className="text-muted-foreground">Approved By</p><p>{interview.approvedByName}</p></div>}
          {interview.notes && <div className="col-span-2"><p className="text-muted-foreground">Notes</p><p>{interview.notes}</p></div>}
        </CardContent>
      </Card>

      {/* Candidates & Panel */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Candidates ({interview.candidatesInfo?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(interview.candidatesInfo ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1">
                <span>{c.name}</span>
                {myFeedbackByCandidate[c.id]
                  ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />Scored</span>
                  : <span className="text-xs text-muted-foreground">{feedbackByCandidate[c.id]?.length ?? 0} score(s)</span>
                }
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Panel ({interview.panelMembers?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(interview.panelMembers ?? []).map((p) => (
              <div key={p.uid} className="text-sm py-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{ROLE_LABELS[p.role] ?? p.role}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Scoring */}
      {canScore && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Score Candidates</CardTitle>
              {allScored && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />All scored
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Panel Evaluation (70%) — 5 criteria, rated 1–5 · Student Feedback (30%) — 5 criteria, rated 1–5
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {(interview.candidatesInfo ?? []).map((c) => {
              const form = scoreForms[c.id] ?? EMPTY_FORM;
              const already = myFeedbackByCandidate[c.id];
              const isSubmitting = submittingFor === c.id;
              const panelScore = calcPanelScore(form);
              const studentScore = calcStudentScore(form);
              const isFormValid = isPanelFilled(form) && isStudentFilled(form) && !!form.recommendation;

              return (
                <div key={c.id} className={`rounded-lg border p-4 space-y-5 ${already ? "border-green-200 bg-green-50/30" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{c.name}</p>
                    {already && (
                      <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Score: {(already.overallScore ?? 0).toFixed(1)}/100 — click to update
                      </Badge>
                    )}
                  </div>

                  <InterviewScoringFields
                    values={form}
                    onChange={(key: ScoringKey, value: number) => updateForm(c.id, { [key]: value })}
                  />

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Recommendation</Label>
                      <div className="flex gap-2">
                        {RECOMMENDATION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateForm(c.id, { recommendation: opt.value })}
                            className={`flex-1 py-1.5 rounded border text-xs font-medium transition-colors ${
                              form.recommendation === opt.value
                                ? opt.color + " ring-2 ring-offset-1 " + opt.ring
                                : "border-muted text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Remarks (optional)</Label>
                      <Textarea
                        value={form.remarks}
                        onChange={(e) => updateForm(c.id, { remarks: e.target.value })}
                        placeholder="Strengths, concerns, notes..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>

                    <Button
                      size="sm"
                      onClick={() => void submitScore(c.id, c.name)}
                      loading={isSubmitting}
                      disabled={!isFormValid || isSubmitting}
                    >
                      {already ? `Update Score (${(panelScore + studentScore).toFixed(1)}/100)` : "Submit Score"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* All panel scores summary */}
      {feedback.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">All Panel Scores</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(interview.candidatesInfo ?? []).map((c) => {
              const cFeedback = feedbackByCandidate[c.id] ?? [];
              if (cFeedback.length === 0) return null;
              const avgOverall = (cFeedback.reduce((s, f) => s + (f.overallScore ?? 0), 0) / cFeedback.length).toFixed(1);
              const avgPanel = (cFeedback.reduce((s, f) => s + (f.panelScore ?? 0), 0) / cFeedback.length).toFixed(1);
              const avgStudent = (cFeedback.reduce((s, f) => s + (f.studentScore ?? 0), 0) / cFeedback.length).toFixed(1);
              const selected = cFeedback.filter((f) => f.recommendation === "SELECTED").length;
              const waitlisted = cFeedback.filter((f) => f.recommendation === "WAITLISTED").length;
              const rejected = cFeedback.filter((f) => f.recommendation === "REJECTED").length;

              return (
                <div key={c.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{c.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-primary">{avgOverall}/100</span>
                      <div className="flex gap-1 text-xs">
                        {selected > 0 && <span className="text-green-700 font-medium">✓ {selected}</span>}
                        {waitlisted > 0 && <span className="text-amber-700 font-medium">~ {waitlisted}</span>}
                        {rejected > 0 && <span className="text-red-700 font-medium">✗ {rejected}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Panel avg: <strong>{avgPanel}/70</strong></span>
                    <span>Student avg: <strong>{avgStudent}/30</strong></span>
                    <span>{cFeedback.length} scored</span>
                  </div>
                  <div className="space-y-1">
                    {cFeedback.map((f) => (
                      <div key={f.id} className="text-xs bg-muted/50 rounded p-2 flex items-start justify-between gap-2">
                        <div>
                          <span className="font-medium">{f.panelName}</span>
                          <span className="text-muted-foreground"> · {(f.overallScore ?? 0).toFixed(1)}/100 (Panel: {(f.panelScore ?? 0).toFixed(1)} + Student: {(f.studentScore ?? 0).toFixed(1)})</span>
                          {f.remarks && <span className="text-muted-foreground"> — {f.remarks}</span>}
                        </div>
                        <StatusBadge status={f.recommendation} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Approve confirm */}
      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve Interview Plan?"
        description={`Approve "${interview.title}" scheduled on ${formatDate(interview.interviewDate as Parameters<typeof formatDate>[0])} at ${interview.venue}. HR Admin will be notified and can send call letters.`}
        confirmLabel="Approve"
        onConfirm={() => void handleApproveReject("APPROVE")}
        loading={actionLoading}
      />
    </div>
  );
}
