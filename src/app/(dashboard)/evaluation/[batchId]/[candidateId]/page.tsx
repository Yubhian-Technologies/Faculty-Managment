"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { CheckCircle2, Clock, ShieldOff } from "lucide-react";
import type { HiringBatch, Candidate, CandidateApplication } from "@/types";

type PersonView = { name: string; email: string };

function Score1to10Selector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${
              value === n
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

type PanelForm = {
  scores: {
    subjectKnowledge?: number;
    presentationSkills?: number;
    research?: number;
    specificAttributes?: number;
    others?: number;
  };
  recommendation: "" | "ACCEPT" | "MAYBE" | "REJECT";
  strengths: string;
  weaknesses: string;
  comments: string;
};

// Each panel member's overall call on the candidate.
const RECOMMENDATION_OPTIONS: [Exclude<PanelForm["recommendation"], "">, string][] = [
  ["ACCEPT", "Strongly Recommend – Take"],
  ["MAYBE", "Recommend with Reservations – Maybe Take"],
  ["REJECT", "Do Not Recommend – Not Suitable"],
];

// Panel evaluation rubric — marks out of 10 per criterion. Replaces the old
// demo-sheet rubric across the HOD / panel / coordinator dashboards.
const PANEL_CRITERIA: [keyof PanelForm["scores"], string][] = [
  ["subjectKnowledge", "Subject Knowledge"],
  ["presentationSkills", "Presentation Skills"],
  ["research", "Research"],
  ["specificAttributes", "Specific Attributes"],
  ["others", "Others"],
];

const defaultPanelForm = (): PanelForm => ({ scores: {}, recommendation: "", strengths: "", weaknesses: "", comments: "" });

type MyFeedback = { candidateId: string; panelUid: string; panelScores?: unknown };

export default function EvaluationPage({ params }: { params: Promise<{ batchId: string; candidateId: string }> }) {
  const { batchId, candidateId } = use(params);
  const router = useRouter();
  const myUid = useAuthStore((s) => s.user?.uid);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [person, setPerson] = useState<PersonView | null>(null);
  const [myFeedback, setMyFeedback] = useState<MyFeedback | null>(null);
  const [panelForm, setPanelForm] = useState<PanelForm>(defaultPanelForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!myUid) return;
    Promise.all([
      fetch(`/api/college/hiring-batches/${batchId}`)
        .then((r) => r.json() as Promise<{ batch: HiringBatch }>)
        .then((d) => d.batch),
      fetch(`/api/college/candidate-applications?batchId=${batchId}`)
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => d.applications ?? []),
      fetch(`/api/college/candidates`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
      fetch(`/api/college/panel-feedback?batchId=${batchId}&candidateId=${candidateId}`)
        .then((r) => r.json() as Promise<{ feedback: MyFeedback[] }>)
        // GET only auto-filters to the caller's own submissions for role PANEL_MEMBER -
        // HOD (and other roles who can also be panelists) need this client-side filter too.
        .then((d) => (d.feedback ?? []).find((f) => f.panelUid === myUid) ?? null),
    ])
      .then(([b, applications, candidates, mine]) => {
        setBatch(b);
        setMyFeedback(mine);
        const application = applications.find((a) => a.candidateId === candidateId);
        const candidate = candidates.find((c) => c.id === candidateId);
        if (application || candidate) {
          setPerson({ name: candidate?.name ?? "Unknown", email: candidate?.email ?? "" });
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load evaluation" }))
      .finally(() => setIsLoading(false));
  }, [batchId, candidateId, myUid]);

  async function submitPanelFeedback() {
    const allRated = PANEL_CRITERIA.every(([key]) => panelForm.scores[key] != null);
    if (!allRated) {
      toast({ variant: "destructive", title: "Please score all 5 criteria out of 10" });
      return;
    }
    if (!panelForm.recommendation) {
      toast({ variant: "destructive", title: "Please select a recommendation" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/panel-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          candidateId,
          panelScores: panelForm.scores,
          recommendation: panelForm.recommendation,
          strengths: panelForm.strengths,
          weaknesses: panelForm.weaknesses,
          comments: panelForm.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Evaluation submitted" });
      router.back();
    } catch {
      toast({ variant: "destructive", title: "Failed to submit evaluation" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Evaluation" description="Loading..." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const isPanelist = (batch.panelMemberUids as string[]).includes(myUid ?? "");
  if (!isPanelist) {
    return (
      <div className="space-y-6">
        <PageHeader title="Evaluation" description={batch.position} />
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-2">
            <ShieldOff className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Not authorized</p>
            <p className="text-sm text-muted-foreground">You are not a panel member for this batch.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Scoring opens only once the HOD opens panel scoring (PANEL_INTERVIEW) —
  // not while the demo itself is still in progress (IN_PROGRESS).
  const canScore =
    batch.currentPhase === "PANEL_INTERVIEW" ||
    batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
    batch.currentPhase === "COMPLETED";
  const alreadySubmitted = myFeedback?.panelScores != null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={person?.name ?? "Candidate"}
        description={`${batch.position} - ${batch.department}`}
      />

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
      ) : alreadySubmitted ? (
        <Card className="border-green-200 bg-green-50/40">
          <CardContent className="p-8 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
            <p className="font-medium">Already Submitted</p>
            <p className="text-sm text-muted-foreground">
              You have already submitted your evaluation for this candidate.
            </p>
            <Button variant="outline" onClick={() => router.back()}>Back</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Panel Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-4">
              {PANEL_CRITERIA.map(([key, label]) => (
                <Score1to10Selector
                  key={key}
                  label={`${label} (out of 10)`}
                  value={panelForm.scores[key]}
                  onChange={(v) => setPanelForm((f) => ({ ...f, scores: { ...f.scores, [key]: v } }))}
                />
              ))}
            </div>

            <div className="space-y-2">
              <Label>Recommendation</Label>
              <Select
                value={panelForm.recommendation}
                onValueChange={(v) => setPanelForm((f) => ({ ...f, recommendation: v as PanelForm["recommendation"] }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a recommendation" />
                </SelectTrigger>
                <SelectContent>
                  {RECOMMENDATION_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Strengths</Label>
              <Textarea
                value={panelForm.strengths}
                onChange={(e) => setPanelForm((f) => ({ ...f, strengths: e.target.value }))}
                placeholder="Candidate's key strengths..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Weaknesses</Label>
              <Textarea
                value={panelForm.weaknesses}
                onChange={(e) => setPanelForm((f) => ({ ...f, weaknesses: e.target.value }))}
                placeholder="Areas of concern or improvement..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea
                value={panelForm.comments}
                onChange={(e) => setPanelForm((f) => ({ ...f, comments: e.target.value }))}
                placeholder="Any other observations..."
                rows={2}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button onClick={submitPanelFeedback} loading={isSaving}>
                Submit Evaluation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
