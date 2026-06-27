"use client";

import { use, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle2,
  MapPin,
  Users,
  QrCode,
  Star,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Clock,
  ArrowRight,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { DESIGNATION_LABELS, ROLE_LABELS } from "@/types";
import type { HiringBatch, Candidate, FacultyMember, FMSUser } from "@/types";

type PanelFeedbackItem = {
  id: string;
  candidateId: string;
  panelName: string;
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  ratings: { technicalKnowledge: number; communicationSkills: number; teachingMethodology: number };
  comments?: string;
};

type StudentFeedbackSummary = {
  candidateId: string;
  count: number;
  averages: Record<string, number>;
};

type HRFeedbackForm = {
  candidateId: string;
  ratings: { attitude: number; teamwork: number; adaptability: number; communication: number; overallFit: number };
  salaryExpectation: string;
  noticePeriod: string;
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  comments: string;
};

function RatingDots({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full ${i < value ? "bg-primary" : "bg-muted-foreground/20"}`} />
      ))}
    </div>
  );
}

function HRRatingSelector({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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

const defaultHRForm = (candidateId: string): HRFeedbackForm => ({
  candidateId,
  ratings: { attitude: 0, teamwork: 0, adaptability: 0, communication: 0, overallFit: 0 },
  salaryExpectation: "",
  noticePeriod: "",
  recommendation: "MAYBE",
  comments: "",
});

export default function HODBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyMember[]>([]);
  const [panelFeedback, setPanelFeedback] = useState<PanelFeedbackItem[]>([]);
  const [studentFeedbackSummary, setStudentFeedbackSummary] = useState<StudentFeedbackSummary[]>([]);
  const [hrFeedback, setHRFeedback] = useState<{ candidateId: string; recommendation: string }[]>([]);
  const [userMap, setUserMap] = useState<Record<string, FMSUser>>({});
  const [allUsers, setAllUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Committee edit state
  const [editingCommittee, setEditingCommittee] = useState(false);
  const [editPanel, setEditPanel] = useState<string[]>([]);
  const [editInterviewDate, setEditInterviewDate] = useState("");
  const [isSavingCommittee, setIsSavingCommittee] = useState(false);

  const [demoClassroom, setDemoClassroom] = useState("");
  const [coordinatorFacultyId, setCoordinatorFacultyId] = useState("");

  // HR feedback form state
  const [hrFormCandidate, setHRFormCandidate] = useState<Candidate | null>(null);
  const [hrForm, setHRForm] = useState<HRFeedbackForm | null>(null);
  const [isSubmittingHR, setIsSubmittingHR] = useState(false);

  // Principal review submission
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);

  async function load() {
    try {
      const [batchRes, candidatesRes, facultyRes, usersRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidates?batchId=${id}`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
        fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>),
        fetch("/api/college/users?allDepts=true&includeAll=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
      ]);
      const b = batchRes.batch;
      setBatch(b);
      const cands = candidatesRes.candidates ?? [];
      setCandidates(cands);
      setFacultyList(facultyRes.faculty ?? []);
      const map: Record<string, FMSUser> = {};
      const users = usersRes.users ?? [];
      for (const u of users) map[u.uid] = u;
      setUserMap(map);
      setAllUsers(users);
      setDemoClassroom(b.demoClassroom ?? "");
      setCoordinatorFacultyId(b.coordinatorFacultyId ?? "");

      // Load feedback when demo is complete
      if (b.demoComplete && cands.length > 0) {
        const [pfRes, sfRes, hrRes] = await Promise.all([
          fetch(`/api/college/panel-feedback?batchId=${id}`)
            .then((r) => r.json() as Promise<{ feedback: PanelFeedbackItem[] }>)
            .then((d) => d.feedback ?? []),
          fetch(`/api/college/student-feedback?batchId=${id}`)
            .then((r) => r.json() as Promise<{ feedback: { candidateId: string; ratings: Record<string, number> }[] }>)
            .then((d) => d.feedback ?? []),
          fetch(`/api/college/hr-feedback?batchId=${id}`)
            .then((r) => r.json() as Promise<{ feedback: { candidateId: string; recommendation: string }[] }>)
            .then((d) => d.feedback ?? []),
        ]);

        setPanelFeedback(pfRes);
        setHRFeedback(hrRes);

        // Aggregate student feedback by candidate
        const summaryMap: Record<string, { count: number; sums: Record<string, number> }> = {};
        for (const sf of sfRes) {
          if (!summaryMap[sf.candidateId]) {
            summaryMap[sf.candidateId] = { count: 0, sums: {} };
          }
          summaryMap[sf.candidateId].count++;
          for (const [k, v] of Object.entries(sf.ratings)) {
            summaryMap[sf.candidateId].sums[k] = (summaryMap[sf.candidateId].sums[k] ?? 0) + v;
          }
        }
        setStudentFeedbackSummary(
          Object.entries(summaryMap).map(([candidateId, { count, sums }]) => ({
            candidateId,
            count,
            averages: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / count])),
          }))
        );
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load batch" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function saveDetails() {
    if (!demoClassroom.trim()) {
      toast({ variant: "destructive", title: "Demo classroom is required" });
      return;
    }
    if (!coordinatorFacultyId) {
      toast({ variant: "destructive", title: "Please assign a coordinator" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoClassroom: demoClassroom.trim(), coordinatorFacultyId }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Details saved", description: "Coordinator has been notified." });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  async function submitHRFeedback() {
    if (!hrForm || !hrFormCandidate) return;
    const allRated = Object.values(hrForm.ratings).every((v) => v > 0);
    if (!allRated) {
      toast({ variant: "destructive", title: "Please rate all 5 criteria" });
      return;
    }
    setIsSubmittingHR(true);
    try {
      const res = await fetch("/api/college/hr-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: id,
          candidateId: hrFormCandidate.id,
          ratings: hrForm.ratings,
          salaryExpectation: hrForm.salaryExpectation ? parseFloat(hrForm.salaryExpectation) : undefined,
          noticePeriod: hrForm.noticePeriod,
          recommendation: hrForm.recommendation,
          comments: hrForm.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "HR feedback saved" });
      setHRFormCandidate(null);
      setHRForm(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to save HR feedback" });
    } finally {
      setIsSubmittingHR(false);
    }
  }

  async function submitForPrincipalReview() {
    setIsSubmittingForReview(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPhase: "PRINCIPAL_FINAL_REVIEW" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Submitted for Principal review", description: "The Principal has been notified to make final hiring decisions." });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to submit for review" });
    } finally {
      setIsSubmittingForReview(false);
    }
  }

  function openCommitteeEdit() {
    if (!batch) return;
    setEditPanel([...batch.panelMemberUids]);
    const d = batch.interviewDate as { seconds?: number } | string | Date | null;
    if (d && typeof d === "object" && "seconds" in d && d.seconds) {
      setEditInterviewDate(new Date(d.seconds * 1000).toISOString().split("T")[0]);
    } else if (d instanceof Date) {
      setEditInterviewDate(d.toISOString().split("T")[0]);
    } else if (typeof d === "string") {
      setEditInterviewDate(d.split("T")[0]);
    }
    setEditingCommittee(true);
  }

  async function saveCommitteeEdit() {
    if (editPanel.length < 2) {
      toast({ variant: "destructive", title: "Select at least 2 panel members" });
      return;
    }
    if (!editInterviewDate) {
      toast({ variant: "destructive", title: "Interview date is required" });
      return;
    }
    setIsSavingCommittee(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelMemberUids: editPanel, interviewDate: editInterviewDate }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Committee updated" });
      setEditingCommittee(false);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update committee" });
    } finally {
      setIsSavingCommittee(false);
    }
  }

  async function markArrived(candidateId: string) {
    try {
      await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasArrived: true }),
      });
      setCandidates((prev) => prev.map((c) => c.id === candidateId ? { ...c, hasArrived: true } : c));
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Batch Details" description="Loading..." />
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Batch not found</div>;

  const canEditCommittee =
    batch.currentPhase !== "PRINCIPAL_FINAL_REVIEW" &&
    batch.currentPhase !== "COMPLETED" &&
    batch.status !== "COMPLETED";

  const selectedCoordinator = facultyList.find((f) => f.id === coordinatorFacultyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch.position}
        description={`${batch.department} — ${formatDate(batch.interviewDate)}`}
      />

      {batch.principalNotes && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <p className="font-medium mb-1">Principal Notes</p>
          <p>{batch.principalNotes}</p>
        </div>
      )}

      {/* Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Status", content: <StatusBadge status={batch.status} /> },
          { label: "Interview Date", content: <p className="font-medium text-sm">{formatDate(batch.interviewDate)}</p> },
          { label: "Venue", content: <p className="font-medium text-sm">{batch.interviewVenue || "Not set"}</p> },
          { label: "Demo", content: batch.demoComplete
            ? <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Complete</span>
            : <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />Pending</span>
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
              {item.content}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* HOD Final Setup — after college office marks setup complete */}
      {batch.setupComplete && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Interview Logistics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="demoClassroom">
                  <MapPin className="h-3 w-3 inline mr-1" />
                  Demo Classroom *
                </Label>
                <Input
                  id="demoClassroom"
                  value={demoClassroom}
                  onChange={(e) => setDemoClassroom(e.target.value)}
                  placeholder="e.g. Room 301, Block A"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  <Users className="h-3 w-3 inline mr-1" />
                  Coordinator *
                </Label>
                <Select value={coordinatorFacultyId} onValueChange={setCoordinatorFacultyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select faculty coordinator..." />
                  </SelectTrigger>
                  <SelectContent>
                    {facultyList.length === 0 ? (
                      <SelectItem value="__none" disabled>No active faculty</SelectItem>
                    ) : (
                      facultyList.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name} · {DESIGNATION_LABELS[f.designation] ?? f.designation}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedCoordinator && !selectedCoordinator.userUid && (
                  <p className="text-xs text-muted-foreground">No login account — notification skipped.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              {(batch.coordinatorFacultyId ?? batch.coordinatorUid) && (
                <Button variant="outline" asChild>
                  <Link href={`/coordinator/${id}`}>
                    <QrCode className="h-4 w-4 mr-2" />
                    Open QR Display
                  </Link>
                </Button>
              )}
              <Button onClick={saveDetails} loading={isSaving}>
                Save & Notify Coordinator
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Candidates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidates ({candidates.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No candidates in this batch.</p>
          ) : (
            candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.email} · {c.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.hasArrived ? (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />Arrived
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void markArrived(c.id)}>
                      Mark Arrived
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Panel Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Panel Members ({batch.panelMemberUids.length})</CardTitle>
            {canEditCommittee && !editingCommittee && (
              <Button size="sm" variant="outline" onClick={openCommitteeEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit Committee
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editingCommittee ? (
            <div className="space-y-5">
              {/* Interview date */}
              <div className="space-y-2">
                <Label htmlFor="edit-interview-date">Interview Date *</Label>
                <Input
                  id="edit-interview-date"
                  type="date"
                  value={editInterviewDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setEditInterviewDate(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              {/* Panel member checkboxes */}
              <div className="space-y-2">
                <Label>
                  Panel Members *
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {editPanel.length} selected (min 2)
                  </span>
                </Label>
                <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border p-2">
                  {allUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-2">No staff found</p>
                  ) : (
                    allUsers.map((u) => (
                      <div key={u.uid} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                        <Checkbox
                          id={`ep-${u.uid}`}
                          checked={editPanel.includes(u.uid)}
                          onCheckedChange={(checked) =>
                            setEditPanel((prev) =>
                              checked ? [...prev, u.uid] : prev.filter((x) => x !== u.uid)
                            )
                          }
                        />
                        <label htmlFor={`ep-${u.uid}`} className="flex-1 cursor-pointer">
                          <p className="text-sm font-medium">{u.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ROLE_LABELS[u.role] ?? u.role}{u.department ? ` · ${u.department}` : ""}
                          </p>
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingCommittee(false)}
                  disabled={isSavingCommittee}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={saveCommitteeEdit} loading={isSavingCommittee}>
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <>
              {batch.panelMemberUids.length === 0 ? (
                <p className="text-sm text-muted-foreground">No panel members assigned.</p>
              ) : (
                batch.panelMemberUids.map((uid) => {
                  const user = userMap[uid];
                  return (
                    <div key={uid} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-primary">
                          {user?.name ? user.name.charAt(0).toUpperCase() : "?"}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{user?.name ?? uid}</p>
                        {user?.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Required Documents */}
      {batch.requiredDocuments && batch.requiredDocuments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Required Documents</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {batch.requiredDocuments.map((doc) => (
                <li key={doc} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground shrink-0" />
                  {doc}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── POST-DEMO SECTIONS ──────────────────────────────────────────────────── */}
      {batch.demoComplete && (
        <>
          {/* Student Feedback Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-500" />
                Student Demo Feedback
              </CardTitle>
            </CardHeader>
            <CardContent>
              {studentFeedbackSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No student feedback received yet.</p>
              ) : (
                <div className="space-y-4">
                  {candidates.map((c) => {
                    const sf = studentFeedbackSummary.find((s) => s.candidateId === c.id);
                    if (!sf) return (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                        <p className="text-sm font-medium">{c.name}</p>
                        <span className="text-xs text-muted-foreground">No responses yet</span>
                      </div>
                    );
                    const overall = sf.averages.overallImpression ?? 0;
                    return (
                      <div key={c.id} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{c.name}</p>
                          <div className="flex items-center gap-2">
                            <RatingDots value={Math.round(overall)} />
                            <span className="text-xs text-muted-foreground">{sf.count} response{sf.count !== 1 ? "s" : ""} · avg {overall.toFixed(1)}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1 sm:grid-cols-5 text-xs text-muted-foreground">
                          {Object.entries(sf.averages).map(([k, v]) => (
                            <div key={k} className="text-center">
                              <p>{v.toFixed(1)}</p>
                              <p className="truncate">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel Feedback Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Panel Interview Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {panelFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">Panel members have not submitted feedback yet.</p>
              ) : (
                <div className="space-y-3">
                  {candidates.map((c) => {
                    const feedbacks = panelFeedback.filter((f) => f.candidateId === c.id);
                    if (feedbacks.length === 0) return (
                      <div key={c.id} className="p-3 rounded-lg bg-muted/40 flex items-center justify-between">
                        <p className="text-sm font-medium">{c.name}</p>
                        <span className="text-xs text-muted-foreground">Pending feedback</span>
                      </div>
                    );
                    const accepts = feedbacks.filter((f) => f.recommendation === "ACCEPT").length;
                    const rejects = feedbacks.filter((f) => f.recommendation === "REJECT").length;
                    const maybes = feedbacks.filter((f) => f.recommendation === "MAYBE").length;
                    return (
                      <div key={c.id} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{c.name}</p>
                          <span className="text-xs text-muted-foreground">{feedbacks.length} panel response{feedbacks.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="flex gap-3 text-xs">
                          <span className="flex items-center gap-1 text-green-600"><ThumbsUp className="h-3 w-3" />{accepts} Accept</span>
                          <span className="flex items-center gap-1 text-amber-600"><Minus className="h-3 w-3" />{maybes} Maybe</span>
                          <span className="flex items-center gap-1 text-red-600"><ThumbsDown className="h-3 w-3" />{rejects} Reject</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* HR Feedback */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">HR Interview Assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {candidates.map((c) => {
                const existing = hrFeedback.find((h) => h.candidateId === c.id);
                const isSelected = hrFormCandidate?.id === c.id;

                return (
                  <div key={c.id}>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        {existing && (
                          <span className={`text-xs font-medium ${
                            existing.recommendation === "ACCEPT" ? "text-green-600"
                            : existing.recommendation === "REJECT" ? "text-red-600"
                            : "text-amber-600"
                          }`}>
                            {existing.recommendation === "ACCEPT" ? "✓ Accepted" : existing.recommendation === "REJECT" ? "✗ Rejected" : "~ Maybe"}
                          </span>
                        )}
                      </div>
                      {!isSelected && (
                        <Button
                          size="sm"
                          variant={existing ? "outline" : "default"}
                          onClick={() => {
                            setHRFormCandidate(c);
                            setHRForm(defaultHRForm(c.id));
                          }}
                        >
                          {existing ? "Edit Assessment" : "Add Assessment"}
                        </Button>
                      )}
                    </div>

                    {/* Inline HR form */}
                    {isSelected && hrForm && (
                      <Card className="mt-2 border-primary/30 bg-primary/5">
                        <CardContent className="p-4 space-y-4">
                          <p className="text-sm font-medium">HR Assessment: {c.name}</p>

                          <div className="space-y-3">
                            {(
                              [
                                ["attitude", "Attitude & Professionalism"],
                                ["teamwork", "Teamwork & Collaboration"],
                                ["adaptability", "Adaptability"],
                                ["communication", "Communication"],
                                ["overallFit", "Overall Cultural Fit"],
                              ] as [keyof typeof hrForm.ratings, string][]
                            ).map(([key, label]) => (
                              <HRRatingSelector
                                key={key}
                                label={label}
                                value={hrForm.ratings[key]}
                                onChange={(v) =>
                                  setHRForm((f) => f ? { ...f, ratings: { ...f.ratings, [key]: v } } : f)
                                }
                              />
                            ))}
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Salary Expectation (₹/month)</Label>
                              <Input
                                type="number"
                                value={hrForm.salaryExpectation}
                                onChange={(e) => setHRForm((f) => f ? { ...f, salaryExpectation: e.target.value } : f)}
                                placeholder="e.g. 45000"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Notice Period</Label>
                              <Input
                                value={hrForm.noticePeriod}
                                onChange={(e) => setHRForm((f) => f ? { ...f, noticePeriod: e.target.value } : f)}
                                placeholder="e.g. Immediate / 30 days"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs">Recommendation</Label>
                            <Select
                              value={hrForm.recommendation}
                              onValueChange={(v) => setHRForm((f) => f ? { ...f, recommendation: v as "ACCEPT" | "REJECT" | "MAYBE" } : f)}
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

                          <div className="space-y-1">
                            <Label className="text-xs">Comments (optional)</Label>
                            <Textarea
                              value={hrForm.comments}
                              onChange={(e) => setHRForm((f) => f ? { ...f, comments: e.target.value } : f)}
                              placeholder="Any additional observations..."
                              rows={2}
                            />
                          </div>

                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => { setHRFormCandidate(null); setHRForm(null); }}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={submitHRFeedback} loading={isSubmittingHR}>
                              Save Assessment
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {/* Submit for Principal Final Review */}
          <Card className={batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED" ? "border-green-200 bg-green-50/40" : "border-primary/20"}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                Submit for Principal Final Approval
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED" ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <div>
                    <p className="font-medium text-sm">Submitted for Principal review</p>
                    <p className="text-xs text-muted-foreground">The Principal will review all evaluations and make final hiring decisions.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2 text-sm">
                    {candidates.map((c) => {
                      const pf = panelFeedback.filter((f) => f.candidateId === c.id);
                      const hr = hrFeedback.find((h) => h.candidateId === c.id);
                      const accepts = pf.filter((f) => f.recommendation === "ACCEPT").length;
                      return (
                        <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Panel: {accepts}/{pf.length} accept
                            {hr ? ` · HR: ${hr.recommendation}` : " · HR: pending"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Submitting will notify the Principal to make the final hiring decision for each candidate.
                  </p>
                  <Button onClick={submitForPrincipalReview} loading={isSubmittingForReview}>
                    Submit All Evaluations to Principal
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Pending demo message */}
      {!batch.demoComplete && batch.setupComplete && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-sm">Waiting for Demo Day</p>
            <p className="text-xs text-muted-foreground mt-1">
              The coordinator will mark the demo complete on interview day. Feedback sections unlock after that.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
