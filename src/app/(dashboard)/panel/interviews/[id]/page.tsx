"use client";

import { use, useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
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
import type { HiringBatch, Candidate, CandidateApplication, DemoRatingLevel } from "@/types";

// Joined view for the candidate list this panel member scores: person fields
// from Candidate, `id` = applicationId (list-key only), `candidateId` = the
// real Candidate id used in panel-feedback POSTs (that schema is unchanged).
type PanelCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
};

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

const DEMO_LEVELS: { value: DemoRatingLevel; label: string }[] = [
  { value: "POOR", label: "Poor" },
  { value: "AVERAGE", label: "Avg" },
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

const DEMO_RUBRIC: [keyof DemoForm["ratings"], string][] = [
  ["planningAndOrganizing", "Planning and Organizing the Subject"],
  ["effectiveUseOfTime", "Effective Use of Time"],
  ["communicativeAbility", "Communicative Ability and Clarity"],
  ["ensuringStudentAttention", "Ensuring Student Attention"],
  ["chalkBoardWork", "Clean and Systematic Chalk Board Work"],
  ["studentParticipation", "Student Participation"],
];

const defaultDemoForm = (): DemoForm => ({ ratings: {}, overallScore: 0, comments: "" });

type FeedbackForm = {
  ratings: {
    technicalKnowledge: number;
    communicationSkills: number;
    teachingMethodology: number;
  };
  remarksByCategory: {
    subjectKnowledge: string;
    communication: string;
    presentationSkills: string;
    research: string;
    specificAttributes: string;
    others: string;
  };
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  strengths: string;
  weaknesses: string;
  comments: string;
};

const REMARK_CATEGORIES: [keyof FeedbackForm["remarksByCategory"], string][] = [
  ["subjectKnowledge", "Subject Knowledge"],
  ["communication", "Communication"],
  ["presentationSkills", "Presentation Skills"],
  ["research", "Research"],
  ["specificAttributes", "Specific Attributes"],
  ["others", "Others"],
];

const defaultFeedback = (): FeedbackForm => ({
  ratings: {
    technicalKnowledge: 0,
    communicationSkills: 0,
    teachingMethodology: 0,
  },
  remarksByCategory: {
    subjectKnowledge: "",
    communication: "",
    presentationSkills: "",
    research: "",
    specificAttributes: "",
    others: "",
  },
  recommendation: "MAYBE",
  strengths: "",
  weaknesses: "",
  comments: "",
});

type MyFeedback = { candidateId: string; panelUid: string; demoRatings?: unknown; ratings?: unknown };

export default function PanelInterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const myUid = useAuthStore((s) => s.user?.uid);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<PanelCandidateView[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<PanelCandidateView | null>(null);
  const [form, setForm] = useState<FeedbackForm>(defaultFeedback());
  const [demoForm, setDemoForm] = useState<DemoForm>(defaultDemoForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

  function selectCandidate(c: PanelCandidateView) {
    setSelectedCandidate(c);
    setForm(defaultFeedback());
    setDemoForm(defaultDemoForm());
  }

  async function submitDemoFeedback() {
    if (!selectedCandidate) return;
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
          batchId: id,
          candidateId: selectedCandidate.candidateId,
          demoRatings: demoForm.ratings,
          demoOverallScore: demoForm.overallScore,
          demoComments: demoForm.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Demo evaluation submitted" });
      setMyFeedback((prev) => [...prev, { candidateId: selectedCandidate.candidateId, panelUid: myUid ?? "", demoRatings: demoForm.ratings }]);
      setSelectedCandidate(null);
      setDemoForm(defaultDemoForm());
    } catch {
      toast({ variant: "destructive", title: "Failed to submit demo evaluation" });
    } finally {
      setIsSaving(false);
    }
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
          candidateId: selectedCandidate.candidateId,
          ratings: form.ratings,
          remarksByCategory: form.remarksByCategory,
          strengths: form.strengths,
          weaknesses: form.weaknesses,
          recommendation: form.recommendation,
          comments: form.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Feedback submitted" });
      setMyFeedback((prev) => [...prev, { candidateId: selectedCandidate.candidateId, panelUid: myUid ?? "", ratings: form.ratings }]);
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

  const isDemoPhase = batch.currentPhase === "IN_PROGRESS";
  const isInterviewPhase =
    batch.currentPhase === "PANEL_INTERVIEW" ||
    batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
    batch.currentPhase === "COMPLETED";
  const canScore = isDemoPhase || isInterviewPhase;

  const doneIds = new Set(
    myFeedback.filter((f) => (isDemoPhase ? f.demoRatings != null : f.ratings != null)).map((f) => f.candidateId)
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
          <div><p className="text-xs text-muted-foreground">Venue</p><p className="font-medium">{batch.interviewVenue || "TBA"}</p></div>
          <div><p className="text-xs text-muted-foreground">Date & Time</p><p className="font-medium">{formatDate(batch.interviewDate)}{batch.interviewTime && <span className="ml-1 text-muted-foreground">{batch.interviewTime}</span>}</p></div>
          <div><p className="text-xs text-muted-foreground">Demo Room</p><p className="font-medium">{batch.demoClassroom || "TBA"}</p></div>
          <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={batch.status} /></div>
        </CardContent>
      </Card>

      {/* Gate: batch must be set up before scoring */}
      {!canScore ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-2">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Scoring Not Yet Open</p>
            <p className="text-sm text-muted-foreground">
              Demo evaluation opens once candidates arrive for their demo class; panel interview scoring opens after the HOD reviews demo day results.
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
                  const done = doneIds.has(c.candidateId);
                  const selected = selectedCandidate?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => !done && selectCandidate(c)}
                      onKeyDown={(e) => {
                        if (done) return;
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectCandidate(c); }
                      }}
                      role={done ? undefined : "button"}
                      tabIndex={done ? undefined : 0}
                      className={`p-3 rounded-lg border transition-colors ${
                        done
                          ? "bg-green-50 border-green-200 cursor-default"
                          : selected
                          ? "border-primary bg-primary/5 cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
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
          {selectedCandidate && isDemoPhase ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Demo Evaluation: {selectedCandidate.name}</CardTitle>
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
                  <Label className="text-xs font-medium">Overall Performance (out of 10)</Label>
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
                  <Button variant="outline" onClick={() => { setSelectedCandidate(null); setDemoForm(defaultDemoForm()); }}>
                    Cancel
                  </Button>
                  <Button onClick={submitDemoFeedback} loading={isSaving}>
                    Submit Evaluation
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : selectedCandidate ? (
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
                      <SelectItem value="ACCEPT">Accept - Recommend for hiring</SelectItem>
                      <SelectItem value="MAYBE">Maybe - Needs further review</SelectItem>
                      <SelectItem value="REJECT">Reject - Not suitable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 pt-1 border-t">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Remarks</Label>
                  {REMARK_CATEGORIES.map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      <Textarea
                        value={form.remarksByCategory[key]}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, remarksByCategory: { ...f.remarksByCategory, [key]: e.target.value } }))
                        }
                        rows={1}
                        className="text-sm"
                      />
                    </div>
                  ))}
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
                <p className="text-sm">Select a candidate from the list to submit your {isDemoPhase ? "demo evaluation" : "feedback"}.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* All submitted */}
      {canScore && doneIds.size === candidates.length && candidates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          You have submitted {isDemoPhase ? "demo evaluations" : "feedback"} for all {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}.
        </div>
      )}
    </div>
  );
}
