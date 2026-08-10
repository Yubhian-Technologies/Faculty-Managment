"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { CheckCircle2, Clock, ShieldOff } from "lucide-react";
import type { HiringBatch, Candidate, CandidateApplication, DemoRatingLevel } from "@/types";

type PersonView = { name: string; email: string };

const DEMO_LEVELS: { value: DemoRatingLevel; label: string }[] = [
  { value: "POOR", label: "Poor" },
  { value: "AVERAGE", label: "Avg." },
  { value: "GOOD", label: "Good" },
  { value: "EXCELLENT", label: "Excellent" },
];

function RatingLevelSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DemoRatingLevel | undefined;
  onChange: (v: DemoRatingLevel) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex gap-1">
        {DEMO_LEVELS.map((lvl) => (
          <button
            key={lvl.value}
            type="button"
            onClick={() => onChange(lvl.value)}
            className={`flex-1 h-9 rounded text-xs font-medium border transition-colors ${
              value === lvl.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {lvl.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type DemoForm = {
  ratings: {
    planningAndOrganizing?: DemoRatingLevel;
    effectiveUseOfTime?: DemoRatingLevel;
    communicativeAbility?: DemoRatingLevel;
    ensuringStudentAttention?: DemoRatingLevel;
    chalkBoardWork?: DemoRatingLevel;
    studentParticipation?: DemoRatingLevel;
  };
  overallScore: number; // 0 = unset, 1-10
  comments: string;
};

// Wording matches docs/hiring/DEMO SHEET.docx exactly - this is the only
// evaluation rubric in the app; there is no separate interview-phase form.
const DEMO_RUBRIC: [keyof DemoForm["ratings"], string][] = [
  ["planningAndOrganizing", "Planning and Organizing the subject"],
  ["effectiveUseOfTime", "Effective use of time"],
  ["communicativeAbility", "Communicative ability and clarity of expression"],
  ["ensuringStudentAttention", "Ensuring student attention"],
  ["chalkBoardWork", "Clean and systematic chalk board work"],
  ["studentParticipation", "Student participation"],
];

const defaultDemoForm = (): DemoForm => ({ ratings: {}, overallScore: 0, comments: "" });

type MyFeedback = { candidateId: string; panelUid: string; demoRatings?: unknown };

export default function EvaluationPage({ params }: { params: Promise<{ batchId: string; candidateId: string }> }) {
  const { batchId, candidateId } = use(params);
  const router = useRouter();
  const myUid = useAuthStore((s) => s.user?.uid);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [person, setPerson] = useState<PersonView | null>(null);
  const [myFeedback, setMyFeedback] = useState<MyFeedback | null>(null);
  const [demoForm, setDemoForm] = useState<DemoForm>(defaultDemoForm());
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

  async function submitDemoFeedback() {
    const allRated = DEMO_RUBRIC.every(([key]) => demoForm.ratings[key] != null);
    if (!allRated || demoForm.overallScore < 1) {
      toast({ variant: "destructive", title: "Please rate all 6 criteria and give an overall score" });
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
          demoRatings: demoForm.ratings,
          demoOverallScore: demoForm.overallScore,
          demoComments: demoForm.comments,
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

  const canScore =
    batch.currentPhase === "IN_PROGRESS" ||
    batch.currentPhase === "PANEL_INTERVIEW" ||
    batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
    batch.currentPhase === "COMPLETED";
  const alreadySubmitted = myFeedback?.demoRatings != null;

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
              Evaluation opens once candidates arrive for their demo class.
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
            <CardTitle className="text-base">Demo Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-4">
              {DEMO_RUBRIC.map(([key, label]) => (
                <RatingLevelSelector
                  key={key}
                  label={label}
                  value={demoForm.ratings[key]}
                  onChange={(v) => setDemoForm((f) => ({ ...f, ratings: { ...f.ratings, [key]: v } }))}
                />
              ))}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Over all performance of the Teacher (Rating on 10 point scale)</Label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemoForm((f) => ({ ...f, overallScore: n }))}
                    className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${
                      demoForm.overallScore >= n
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Comments (optional)</Label>
              <Textarea
                value={demoForm.comments}
                onChange={(e) => setDemoForm((f) => ({ ...f, comments: e.target.value }))}
                placeholder="Any other observations from the demo class..."
                rows={2}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button onClick={submitDemoFeedback} loading={isSaving}>
                Submit Evaluation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
