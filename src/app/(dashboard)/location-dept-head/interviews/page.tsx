"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";

interface InterviewCandidate { id: string; name: string; }
interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: InterviewCandidate[];
  status: string;
  callLetterSent: boolean;
}

interface FeedbackForm {
  candidateId: string;
  technicalScore: string;
  communicationScore: string;
  remarks: string;
  recommendation: string;
}

export default function HODInterviewsPage() {
  const [interviews, setInterviews] = useState<LocationInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [activeInterview, setActiveInterview] = useState<LocationInterview | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackForm>({
    candidateId: "", technicalScore: "", communicationScore: "", remarks: "", recommendation: "",
  });

  function load() {
    setIsLoading(true);
    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: LocationInterview[] }>)
      .then((d) => setInterviews(d.interviews ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function openFeedback(interview: LocationInterview) {
    setActiveInterview(interview);
    setFeedback({ candidateId: "", technicalScore: "", communicationScore: "", remarks: "", recommendation: "" });
    setFeedbackOpen(true);
  }

  async function handleSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!activeInterview || !feedback.candidateId || !feedback.recommendation || !feedback.technicalScore || !feedback.communicationScore) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/location/interviews/${activeInterview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_FEEDBACK",
          candidateId: feedback.candidateId,
          candidateName: activeInterview.candidatesInfo.find((c) => c.id === feedback.candidateId)?.name ?? "",
          technicalScore: Number(feedback.technicalScore),
          communicationScore: Number(feedback.communicationScore),
          remarks: feedback.remarks,
          recommendation: feedback.recommendation,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Feedback submitted" });
      setFeedbackOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Failed to submit feedback" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Interviews" description="Interviews you are assigned to as a panel member" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : interviews.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No interviews assigned to you yet.
        </div>
      ) : (
        <div className="space-y-4">
          {interviews.map((i) => (
            <Card key={i.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{i.title}</CardTitle>
                  <StatusBadge status={i.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Interview Date</p>
                    <p>{formatDate(i.interviewDate as Parameters<typeof formatDate>[0])}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Venue</p>
                    <p>{i.venue}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Candidates</p>
                    <p>{i.candidatesInfo?.length ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Call Letters</p>
                    <p>{i.callLetterSent ? "Sent" : "Pending"}</p>
                  </div>
                </div>
                {(i.status === "APPROVED" || i.status === "COMPLETED") && (
                  <Button size="sm" onClick={() => openFeedback(i)}>Submit Feedback</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Submit Interview Feedback</DialogTitle>
            <p className="text-sm text-muted-foreground">{activeInterview?.title}</p>
          </DialogHeader>
          <form onSubmit={handleSubmitFeedback} className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Candidate <span className="text-destructive">*</span></Label>
              <Select value={feedback.candidateId} onValueChange={(v) => setFeedback((f) => ({ ...f, candidateId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select candidate..." /></SelectTrigger>
                <SelectContent>
                  {(activeInterview?.candidatesInfo ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Technical Score (1–10) <span className="text-destructive">*</span></Label>
                <Input
                  type="number" min={1} max={10}
                  value={feedback.technicalScore}
                  onChange={(e) => setFeedback((f) => ({ ...f, technicalScore: e.target.value }))}
                  placeholder="8"
                />
              </div>
              <div className="space-y-2">
                <Label>Communication Score (1–10) <span className="text-destructive">*</span></Label>
                <Input
                  type="number" min={1} max={10}
                  value={feedback.communicationScore}
                  onChange={(e) => setFeedback((f) => ({ ...f, communicationScore: e.target.value }))}
                  placeholder="7"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Recommendation <span className="text-destructive">*</span></Label>
              <Select value={feedback.recommendation} onValueChange={(v) => setFeedback((f) => ({ ...f, recommendation: v }))}>
                <SelectTrigger><SelectValue placeholder="Select recommendation..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELECTED">Select — Recommended for hire</SelectItem>
                  <SelectItem value="WAITLISTED">Waitlist — Keep in reserve</SelectItem>
                  <SelectItem value="REJECTED">Reject — Not suitable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={feedback.remarks}
                onChange={(e) => setFeedback((f) => ({ ...f, remarks: e.target.value }))}
                rows={3}
                placeholder="Strengths, areas of concern, specific observations..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFeedbackOpen(false)} disabled={saving}>Cancel</Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!feedback.candidateId || !feedback.recommendation || !feedback.technicalScore || !feedback.communicationScore}
              >
                Submit Feedback
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
