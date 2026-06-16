"use client";

import { use, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, Clock } from "lucide-react";
import type { HiringBatch, Candidate } from "@/types";

function RatingSelector({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-9 h-9 rounded text-sm font-medium border transition-colors ${
              value >= n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

type FeedbackForm = {
  ratings: {
    technicalKnowledge: number;
    communicationSkills: number;
    teachingMethodology: number;
  };
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  strengths: string;
  weaknesses: string;
  comments: string;
};

const defaultFeedback = (): FeedbackForm => ({
  ratings: {
    technicalKnowledge: 0,
    communicationSkills: 0,
    teachingMethodology: 0,
  },
  recommendation: "MAYBE",
  strengths: "",
  weaknesses: "",
  comments: "",
});

export default function PanelInterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [form, setForm] = useState<FeedbackForm>(defaultFeedback());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [submittedFor, setSubmittedFor] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/college/hiring-batches/${id}`)
        .then((r) => r.json() as Promise<{ batch: HiringBatch }>)
        .then((d) => d.batch),
      fetch(`/api/college/panel-feedback?batchId=${id}`)
        .then((r) => r.json() as Promise<{ feedback: { candidateId: string }[] }>)
        .then((d) => d.feedback.map((f) => f.candidateId)),
    ])
      .then(([b, submitted]) => {
        setBatch(b);
        setSubmittedFor(submitted);
        if (b.candidateIds.length > 0) {
          return fetch(`/api/college/candidates?batchId=${id}`)
            .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
            .then((d) => { setCandidates(d.candidates ?? []); });
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load interview" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  function selectCandidate(c: Candidate) {
    setSelectedCandidate(c);
    setForm(defaultFeedback());
  }

  async function submitFeedback() {
    if (!selectedCandidate) return;
    const allRated = Object.values(form.ratings).every((v) => v > 0);
    if (!allRated) {
      toast({ variant: "destructive", title: "Please rate all 3 criteria" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/panel-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: id,
          candidateId: selectedCandidate.id,
          ratings: form.ratings,
          strengths: form.strengths,
          weaknesses: form.weaknesses,
          recommendation: form.recommendation,
          comments: form.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Feedback submitted" });
      setSubmittedFor((prev) => [...prev, selectedCandidate.id]);
      setSelectedCandidate(null);
      setForm(defaultFeedback());
    } catch {
      toast({ variant: "destructive", title: "Failed to submit feedback" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Interview" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const demoComplete = batch.demoComplete;

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch.position}
        description={`${batch.department} — ${formatDate(batch.interviewDate)}`}
      />

      {/* Batch Info */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Venue</p><p className="font-medium">{batch.interviewVenue || "TBA"}</p></div>
          <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{formatDate(batch.interviewDate)}</p></div>
          <div><p className="text-xs text-muted-foreground">Demo Room</p><p className="font-medium">{batch.demoClassroom || "TBA"}</p></div>
          <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={batch.status} /></div>
        </CardContent>
      </Card>

      {/* Gate: demo must be complete before feedback */}
      {!demoComplete ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-2">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Demo Class Not Yet Complete</p>
            <p className="text-sm text-muted-foreground">
              The coordinator will mark the demo as complete on interview day. Panel feedback will unlock after that.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Candidate List */}
          <Card>
            <CardHeader><CardTitle className="text-base">Candidates ({candidates.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates in this batch.</p>
              ) : (
                candidates.map((c) => {
                  const done = submittedFor.includes(c.id);
                  const selected = selectedCandidate?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => !done && selectCandidate(c)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        done
                          ? "bg-green-50 border-green-200 cursor-default"
                          : selected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted"
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
                        ) : selected ? (
                          <span className="text-xs text-primary font-medium">Selected</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">Rate</Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Feedback Form */}
          {selectedCandidate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feedback: {selectedCandidate.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-4">
                  {(
                    [
                      ["technicalKnowledge", "Technical / Subject Knowledge"],
                      ["communicationSkills", "Communication Skills"],
                      ["teachingMethodology", "Teaching Methodology"],
                    ] as [keyof typeof form.ratings, string][]
                  ).map(([key, label]) => (
                    <RatingSelector
                      key={key}
                      label={label}
                      value={form.ratings[key]}
                      onChange={(v) =>
                        setForm((f) => ({ ...f, ratings: { ...f.ratings, [key]: v } }))
                      }
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Overall Recommendation</Label>
                  <Select
                    value={form.recommendation}
                    onValueChange={(v) => setForm((f) => ({ ...f, recommendation: v as FeedbackForm["recommendation"] }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACCEPT">Accept — Recommend for hiring</SelectItem>
                      <SelectItem value="MAYBE">Maybe — Needs further review</SelectItem>
                      <SelectItem value="REJECT">Reject — Not suitable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Strengths (optional)</Label>
                  <Textarea
                    value={form.strengths}
                    onChange={(e) => setForm((f) => ({ ...f, strengths: e.target.value }))}
                    placeholder="Key strengths observed..."
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Areas for Improvement (optional)</Label>
                  <Textarea
                    value={form.weaknesses}
                    onChange={(e) => setForm((f) => ({ ...f, weaknesses: e.target.value }))}
                    placeholder="What could be improved..."
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Additional Comments (optional)</Label>
                  <Textarea
                    value={form.comments}
                    onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
                    placeholder="Any other observations..."
                    rows={2}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setSelectedCandidate(null); setForm(defaultFeedback()); }}>
                    Cancel
                  </Button>
                  <Button onClick={submitFeedback} loading={isSaving}>
                    Submit Feedback
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-muted-foreground">
                <p className="text-sm">Select a candidate from the list to submit your feedback.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* All submitted */}
      {demoComplete && submittedFor.length === candidates.length && candidates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          You have submitted feedback for all {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}.
        </div>
      )}
    </div>
  );
}
