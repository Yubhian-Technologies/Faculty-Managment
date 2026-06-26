"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";

interface InterviewFeedback {
  id: string;
  panelName: string;
  panelRole: string;
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
  approvedByName?: string;
}

export default function HRInterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [interview, setInterview] = useState<LocationInterview | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [sending, setSending] = useState(false);

  function load() {
    setIsLoading(true);
    fetch(`/api/location/interviews/${id}`)
      .then((r) => r.json() as Promise<{ interview: LocationInterview; feedback: InterviewFeedback[] }>)
      .then((d) => { setInterview(d.interview); setFeedback(d.feedback ?? []); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function sendCallLetters() {
    setSending(true);
    try {
      const res = await fetch(`/api/location/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SEND_CALL_LETTERS" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Call letters sent" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to send" });
    } finally {
      setSending(false);
    }
  }

  async function markComplete() {
    setCompleting(true);
    try {
      const res = await fetch(`/api/location/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "MARK_COMPLETE" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Interview marked as complete" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed" });
    } finally {
      setCompleting(false);
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    ADMINISTRATION: "Administration",
    HR_ADMIN: "HR Admin",
    LOCATION_DEPT_HEAD: "Dept Head",
  };

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading...</div>;
  if (!interview) return <div className="text-sm text-destructive p-6">Interview not found.</div>;

  // Group feedback by candidate
  const feedbackByCandidate = feedback.reduce<Record<string, InterviewFeedback[]>>((acc, f) => {
    if (!acc[f.candidateId]) acc[f.candidateId] = [];
    acc[f.candidateId].push(f);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={interview.title}
        description={`Created by ${interview.createdByName}`}
        actions={
          <div className="flex gap-2">
            {interview.status === "APPROVED" && !interview.callLetterSent && (
              <Button onClick={() => void sendCallLetters()} loading={sending}>Send Call Letters</Button>
            )}
            {(interview.status === "APPROVED") && interview.callLetterSent && (
              <Button variant="outline" onClick={() => void markComplete()} loading={completing}>Mark Complete</Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Interview Info</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Status</p><StatusBadge status={interview.status} /></div>
          <div><p className="text-muted-foreground">Interview Date</p><p>{formatDate(interview.interviewDate as Parameters<typeof formatDate>[0])}</p></div>
          <div><p className="text-muted-foreground">Venue</p><p>{interview.venue}</p></div>
          <div><p className="text-muted-foreground">Call Letters</p><p>{interview.callLetterSent ? "Sent" : "Not yet sent"}</p></div>
          {interview.approvedByName && <div><p className="text-muted-foreground">Approved By</p><p>{interview.approvedByName}</p></div>}
          {interview.notes && <div className="col-span-2"><p className="text-muted-foreground">Notes</p><p>{interview.notes}</p></div>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Candidates ({interview.candidatesInfo?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(interview.candidatesInfo ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1">
                <span>{c.name}</span>
                {feedbackByCandidate[c.id] && (
                  <Badge variant="outline" className="text-xs">
                    {feedbackByCandidate[c.id].length} feedback(s)
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Panel Members ({interview.panelMembers?.length ?? 0})</CardTitle></CardHeader>
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

      {feedback.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Panel Feedback</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(interview.candidatesInfo ?? []).map((c) => {
              const cFeedback = feedbackByCandidate[c.id] ?? [];
              if (cFeedback.length === 0) return null;
              const avgTech = Math.round(cFeedback.reduce((s, f) => s + f.technicalScore, 0) / cFeedback.length * 10) / 10;
              const avgComm = Math.round(cFeedback.reduce((s, f) => s + f.communicationScore, 0) / cFeedback.length * 10) / 10;
              return (
                <div key={c.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{c.name}</p>
                    <div className="flex gap-1">
                      {Array.from(new Set(cFeedback.map((f) => f.recommendation))).map((r) => (
                        <StatusBadge key={r} status={r} />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Avg Technical: <strong>{avgTech}/10</strong></span>
                    <span>Avg Communication: <strong>{avgComm}/10</strong></span>
                  </div>
                  <div className="space-y-1">
                    {cFeedback.map((f) => (
                      <div key={f.id} className="text-xs bg-muted/50 rounded p-2">
                        <span className="font-medium">{f.panelName}</span>
                        {f.remarks && <span className="text-muted-foreground"> — {f.remarks}</span>}
                      </div>
                    ))}
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
