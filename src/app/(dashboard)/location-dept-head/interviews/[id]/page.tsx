"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, Star } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface InterviewFeedback {
  id: string;
  panelUid: string;
  panelName: string;
  candidateId: string;
  candidateName: string;
  technicalScore: number;
  communicationScore: number;
  remarks: string;
  recommendation: string;
}

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  notes: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: { id: string; name: string }[];
  status: string;
  callLetterSent: boolean;
  createdByName: string;
}

type Recommendation = "SELECTED" | "WAITLISTED" | "REJECTED";

interface ScoreForm {
  technicalScore: number;
  communicationScore: number;
  remarks: string;
  recommendation: Recommendation | "";
}

function ScorePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-7 w-7 rounded text-xs font-semibold transition-colors ${
            value === n
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-primary/10"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

const RECOMMENDATION_OPTIONS: { value: Recommendation; label: string; color: string; ring: string }[] = [
  { value: "SELECTED", label: "Select", color: "border-green-400 text-green-700 bg-green-50 hover:bg-green-100", ring: "ring-green-400" },
  { value: "WAITLISTED", label: "Waitlist", color: "border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100", ring: "ring-amber-400" },
  { value: "REJECTED", label: "Reject", color: "border-red-400 text-red-700 bg-red-50 hover:bg-red-100", ring: "ring-red-400" },
];

export default function DeptHeadInterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [interview, setInterview] = useState<LocationInterview | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback[]>([]);
  const myUid = useAuthStore((s) => s.user?.uid ?? "");
  const [isLoading, setIsLoading] = useState(true);
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
            technicalScore: f.technicalScore,
            communicationScore: f.communicationScore,
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
    setScoreForms((prev) => ({
      ...prev,
      [candidateId]: { ...{ technicalScore: 0, communicationScore: 0, remarks: "", recommendation: "" }, ...prev[candidateId], ...patch },
    }));
  }

  async function submitScore(candidateId: string, candidateName: string) {
    const form = scoreForms[candidateId];
    if (!form?.technicalScore || !form?.communicationScore || !form?.recommendation) {
      toast({ variant: "destructive", title: "Fill all scores and a recommendation" });
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
          technicalScore: form.technicalScore,
          communicationScore: form.communicationScore,
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

  const canScore = interview.status === "APPROVED" || interview.status === "COMPLETED";
  const myFeedbackByCandidate = feedback
    .filter((f) => f.panelUid === myUid)
    .reduce<Record<string, InterviewFeedback>>((acc, f) => { acc[f.candidateId] = f; return acc; }, {});

  const allScored = (interview.candidatesInfo ?? []).length > 0 &&
    (interview.candidatesInfo ?? []).every((c) => myFeedbackByCandidate[c.id]);

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title={interview.title} description={`Panel interview — score each candidate below`} />

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 text-sm pt-5">
          <div><p className="text-muted-foreground">Status</p><StatusBadge status={interview.status} /></div>
          <div><p className="text-muted-foreground">Date</p><p>{formatDate(interview.interviewDate as Parameters<typeof formatDate>[0])}</p></div>
          <div><p className="text-muted-foreground">Venue</p><p>{interview.venue}</p></div>
          {interview.notes && <div className="col-span-2"><p className="text-muted-foreground">Notes</p><p>{interview.notes}</p></div>}
        </CardContent>
      </Card>

      {!canScore && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Scoring is available once Administration approves the interview plan and HR Admin sends call letters.
        </div>
      )}

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
              Rate each candidate on Technical (1–10) and Communication (1–10), then give your recommendation.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {(interview.candidatesInfo ?? []).map((c) => {
              const form = scoreForms[c.id] ?? { technicalScore: 0, communicationScore: 0, remarks: "", recommendation: "" };
              const already = myFeedbackByCandidate[c.id];
              const isSubmitting = submittingFor === c.id;

              return (
                <div key={c.id} className={`rounded-lg border p-4 space-y-4 ${already ? "border-green-200 bg-green-50/30" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{c.name}</p>
                    {already && (
                      <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />Submitted — click to update
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <Star className="h-3 w-3" />Technical Score
                        {form.technicalScore > 0 && <span className="text-primary font-semibold ml-1">{form.technicalScore}/10</span>}
                      </Label>
                      <ScorePicker value={form.technicalScore} onChange={(v) => updateForm(c.id, { technicalScore: v })} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <Star className="h-3 w-3" />Communication Score
                        {form.communicationScore > 0 && <span className="text-primary font-semibold ml-1">{form.communicationScore}/10</span>}
                      </Label>
                      <ScorePicker value={form.communicationScore} onChange={(v) => updateForm(c.id, { communicationScore: v })} />
                    </div>

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
                      disabled={!form.technicalScore || !form.communicationScore || !form.recommendation || isSubmitting}
                    >
                      {already ? "Update Score" : "Submit Score"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
