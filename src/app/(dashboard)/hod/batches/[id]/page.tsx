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
  Star,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Clock,
  ArrowRight,
  Pencil,
  Mail,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DESIGNATION_LABELS, ROLE_LABELS } from "@/types";
import type { HiringBatch, Candidate, FacultyMember, FMSUser } from "@/types";
import { useAuthStore } from "@/store/authStore";

type PanelFeedbackItem = {
  id: string;
  candidateId: string;
  panelUid: string;
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

type FeedbackForm = {
  ratings: { technicalKnowledge: number; communicationSkills: number; teachingMethodology: number };
  recommendation: "ACCEPT" | "REJECT" | "MAYBE";
  strengths: string;
  weaknesses: string;
  comments: string;
};

const defaultFeedback = (): FeedbackForm => ({
  ratings: { technicalKnowledge: 0, communicationSkills: 0, teachingMethodology: 0 },
  recommendation: "MAYBE",
  strengths: "",
  weaknesses: "",
  comments: "",
});

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
              value >= n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function RatingDots({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`h-2 w-2 rounded-full ${i < value ? "bg-primary" : "bg-muted-foreground/20"}`} />
      ))}
    </div>
  );
}

export default function HODBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const myUid = useAuthStore((s) => s.user?.uid ?? "");

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyMember[]>([]);
  const [panelFeedback, setPanelFeedback] = useState<PanelFeedbackItem[]>([]);
  const [studentFeedbackSummary, setStudentFeedbackSummary] = useState<StudentFeedbackSummary[]>([]);
  const [userMap, setUserMap] = useState<Record<string, FMSUser>>({});
  const [allUsers, setAllUsers] = useState<FMSUser[]>([]);
  const [collegeName, setCollegeName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Committee edit state
  const [editingCommittee, setEditingCommittee] = useState(false);
  const [editPanel, setEditPanel] = useState<string[]>([]);
  const [editInterviewDate, setEditInterviewDate] = useState("");
  const [isSavingCommittee, setIsSavingCommittee] = useState(false);

  const [demoClassroom, setDemoClassroom] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [coordinatorFacultyId, setCoordinatorFacultyId] = useState("");
  const [interviewVenue, setInterviewVenue] = useState("");
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [newDoc, setNewDoc] = useState("");

  // Phase transitions
  const [isReleasingToPanel, setIsReleasingToPanel] = useState(false);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);

  // HOD's own panel assessment (when HOD is also a panel member)
  const [hodSelectedCandidate, setHodSelectedCandidate] = useState<Candidate | null>(null);
  const [hodForm, setHodForm] = useState<FeedbackForm>(defaultFeedback());
  const [isSubmittingHodFeedback, setIsSubmittingHodFeedback] = useState(false);

  async function load() {
    try {
      const [batchRes, candidatesRes, facultyRes, usersRes, infoRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidates?batchId=${id}`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
        fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>),
        fetch("/api/college/users?allDepts=true&includeAll=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
        fetch("/api/college/info").then((r) => r.json() as Promise<{ name?: string }>),
      ]);
      setCollegeName(infoRes.name ?? "");
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
      setMeetingLink(b.meetingLink ?? "");
      setCoordinatorFacultyId(b.coordinatorFacultyId ?? "");
      setInterviewVenue(b.interviewVenue ?? "");
      setRequiredDocuments(b.requiredDocuments ?? []);

      // Load feedback from demo-complete phase onward
      const postDemo = ["IN_PROGRESS", "PANEL_INTERVIEW", "PRINCIPAL_FINAL_REVIEW", "COMPLETED"].includes(b.currentPhase);
      if (postDemo && cands.length > 0) {
        const [pfRes, sfRes] = await Promise.all([
          fetch(`/api/college/panel-feedback?batchId=${id}`)
            .then((r) => r.json() as Promise<{ feedback: PanelFeedbackItem[] }>)
            .then((d) => d.feedback ?? []),
          fetch(`/api/college/student-feedback?batchId=${id}`)
            .then((r) => r.json() as Promise<{ feedback: { candidateId: string; ratings: Record<string, number> }[] }>)
            .then((d) => d.feedback ?? []),
        ]);

        setPanelFeedback(pfRes);

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

  // Panel members submit from their own tabs while this page sits open —
  // refetch on refocus so submitted/pending status doesn't go stale.
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

  async function saveDetails() {
    if (!coordinatorFacultyId) {
      toast({ variant: "destructive", title: "Please assign a coordinator" });
      return;
    }
    if (!interviewVenue.trim()) {
      toast({ variant: "destructive", title: "Please enter the interview venue" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewVenue: interviewVenue.trim(),
          requiredDocuments,
          demoClassroom: demoClassroom.trim(),
          meetingLink: meetingLink.trim(),
          coordinatorFacultyId,
          setupComplete: true,
          currentPhase: "INTERVIEW_READY",
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Setup saved", description: "Coordinator has been notified. Session is ready." });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  async function releaseToPanelInterview() {
    setIsReleasingToPanel(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPhase: "PANEL_INTERVIEW" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Panel scoring opened", description: "Panel members have been notified to submit their assessments." });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to release" });
    } finally {
      setIsReleasingToPanel(false);
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

  async function submitHodFeedback() {
    if (!hodSelectedCandidate) return;
    const allRated = Object.values(hodForm.ratings).every((v) => v > 0);
    if (!allRated) {
      toast({ variant: "destructive", title: "Please rate all 3 criteria" });
      return;
    }
    setIsSubmittingHodFeedback(true);
    try {
      const res = await fetch("/api/college/panel-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: id,
          candidateId: hodSelectedCandidate.id,
          ratings: hodForm.ratings,
          strengths: hodForm.strengths,
          weaknesses: hodForm.weaknesses,
          recommendation: hodForm.recommendation,
          comments: hodForm.comments,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Assessment submitted" });
      setHodSelectedCandidate(null);
      setHodForm(defaultFeedback());
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to submit assessment" });
    } finally {
      setIsSubmittingHodFeedback(false);
    }
  }

  function sendCallLetter(candidate: Candidate) {
    if (!batch) return;

    const institution = collegeName || "Sri Vishnu Educational Society";
    const date = formatDate(batch.interviewDate);
    const time = batch.interviewTime || "To be notified";
    const venue = batch.interviewVenue || "To be notified";
    const mode = candidate.interviewMode === "ONLINE" ? "Online" : "Offline";
    const meetLink = batch.meetingLink || "";
    const docs = (batch.requiredDocuments ?? []).length > 0
      ? (batch.requiredDocuments ?? []).map((d) => `• ${d}`).join("\n")
      : "• Updated Resume/Curriculum Vitae\n• Passport-size Photograph\n• Original and Photocopies of Educational Certificates\n• Experience Certificates (if applicable)\n• Government-issued Photo ID Proof";

    const body = `Dear Dr./Mr./Ms. ${candidate.name},

Greetings from ${institution}.

Thank you for your interest in joining our institution. Based on your application and profile, we are pleased to invite you to attend an interview for the position of Faculty – ${batch.department}.

INTERVIEW DETAILS:

• Date: ${date}
• Time: ${time}
• Venue: ${venue}
• Mode: ${mode}
• Reporting Time: Please arrive 15 minutes before the scheduled time${mode === "Online" && meetLink ? `\n• Meeting Link: ${meetLink}` : ""}

Kindly bring the following documents for verification:

${docs}
• Any other relevant supporting documents

Please confirm your availability by replying to this email.

Contact Person: ${batch.hodName}

We look forward to meeting you and discussing how your skills and experience can contribute to our institution.

Thank you, and we wish you all the best.

Warm regards,

${batch.hodName}
Head of Department – ${batch.department}
${institution}`;

    // Collect principal and VP emails for CC
    const ccEmails = allUsers
      .filter((u) => u.role === "PRINCIPAL" || u.role === "VICE_PRINCIPAL")
      .map((u) => u.email)
      .filter(Boolean)
      .join(",");

    const subject = `Interview Call Letter – ${batch.position} | ${institution}`;
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(candidate.email)}&cc=${encodeURIComponent(ccEmails)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, "_blank");
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
    batch.currentPhase !== "IN_PROGRESS" &&
    batch.currentPhase !== "PANEL_INTERVIEW" &&
    batch.currentPhase !== "PRINCIPAL_FINAL_REVIEW" &&
    batch.currentPhase !== "COMPLETED";

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
          { label: "Interview Date & Time", content: (
            <p className="font-medium text-sm">
              {formatDate(batch.interviewDate)}
              {batch.interviewTime && <span className="ml-2 text-muted-foreground">{batch.interviewTime}</span>}
            </p>
          )},
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

      {/* Interview Setup — HOD fills venue, documents, demo room, and coordinator */}
      {batch.currentPhase === "HOD_FINAL_SETUP" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Interview Setup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Venue */}
            <div className="space-y-2">
              <Label htmlFor="interviewVenue">
                <MapPin className="h-3 w-3 inline mr-1" />
                Interview Venue *
              </Label>
              <Input
                id="interviewVenue"
                value={interviewVenue}
                onChange={(e) => setInterviewVenue(e.target.value)}
                placeholder="e.g. Conference Hall, Block B, 2nd Floor"
              />
            </div>

            {/* Required Documents */}
            <div className="space-y-2">
              <Label>Required Documents <span className="font-normal text-muted-foreground">(candidates must bring)</span></Label>
              <div className="flex gap-2">
                <Input
                  value={newDoc}
                  onChange={(e) => setNewDoc(e.target.value)}
                  placeholder="e.g. Resume, Aadhar Card, Certificates"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newDoc.trim()) {
                      e.preventDefault();
                      setRequiredDocuments((prev) => [...prev, newDoc.trim()]);
                      setNewDoc("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (newDoc.trim()) {
                      setRequiredDocuments((prev) => [...prev, newDoc.trim()]);
                      setNewDoc("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
              {requiredDocuments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {requiredDocuments.map((doc) => (
                    <span
                      key={doc}
                      className="flex items-center gap-1 bg-muted text-sm px-2.5 py-1 rounded-full"
                    >
                      {doc}
                      <button
                        type="button"
                        onClick={() => setRequiredDocuments((prev) => prev.filter((d) => d !== doc))}
                        className="ml-0.5 text-muted-foreground hover:text-destructive text-base leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="demoClassroom">
                  <MapPin className="h-3 w-3 inline mr-1" />
                  Demo Classroom
                </Label>
                <Input
                  id="demoClassroom"
                  value={demoClassroom}
                  onChange={(e) => setDemoClassroom(e.target.value)}
                  placeholder="e.g. Room 301, Block A"
                />
                <p className="text-xs text-muted-foreground">Room where offline candidates give demo class.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meetingLink">Online Meeting Link</Label>
                <Input
                  id="meetingLink"
                  type="url"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                />
                <p className="text-xs text-muted-foreground">For online candidates.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  <Users className="h-3 w-3 inline mr-1" />
                  Demo Coordinator *
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

            <div className="flex justify-end">
              <Button onClick={saveDetails} loading={isSaving}>
                Save Setup & Mark Ready
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send Call Letters — only between setup complete and demo day */}
      {batch.setupComplete && !batch.demoComplete && candidates.length > 0 && (
        <Card id="call-letters" className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-600" />
              Send Interview Call Letters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Click to open Gmail with a pre-filled call letter. Principal and Vice Principal will be automatically added to CC.
            </p>
            <div className="space-y-2">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border bg-white">
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => sendCallLetter(c)}>
                    <Mail className="h-3.5 w-3.5 mr-1.5" />
                    Send Call Letter
                  </Button>
                </div>
              ))}
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
                {batch.currentPhase === "INTERVIEW_READY" && (
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
                )}
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


      {/* ── STEP A: Demo complete — HOD reviews student scores ─────────────────── */}
      {(batch.currentPhase === "IN_PROGRESS" || batch.currentPhase === "PANEL_INTERVIEW" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED") && (
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
      )}

      {/* ── STEP B: HOD releases to panel interview scoring ─────────────────────── */}
      {batch.currentPhase === "IN_PROGRESS" && (
        <Card className="border-primary/30">
          <CardContent className="p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Release for Panel Interview Scoring</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Once you review the demo scores above, open panel scoring so all panel members can submit their interview assessments.
              </p>
            </div>
            <Button onClick={() => void releaseToPanelInterview()} loading={isReleasingToPanel} className="shrink-0">
              <ArrowRight className="h-4 w-4 mr-2" />
              Open Panel Scoring
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── HOD's own assessment — shown when HOD is also a panel member ──────── */}
      {batch.currentPhase === "PANEL_INTERVIEW" && (batch.panelMemberUids as string[]).includes(myUid) && (() => {
        const hodSubmittedFor = panelFeedback.filter((f) => f.panelUid === myUid).map((f) => f.candidateId);
        const allDone = candidates.length > 0 && candidates.every((c) => hodSubmittedFor.includes(c.id));
        return (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                My Interview Assessment
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allDone ? (
                <div className="flex items-center gap-2 text-sm text-green-600 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  You have submitted your assessment for all {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Candidate picker */}
                  <div className="space-y-2">
                    {candidates.map((c) => {
                      const done = hodSubmittedFor.includes(c.id);
                      const selected = hodSelectedCandidate?.id === c.id;
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (!done) {
                              setHodSelectedCandidate(c);
                              setHodForm(defaultFeedback());
                            }
                          }}
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
                                <CheckCircle2 className="h-3 w-3" />Submitted
                              </span>
                            ) : selected ? (
                              <span className="text-xs text-primary font-medium">Selected</span>
                            ) : (
                              <Badge variant="outline" className="text-xs">Rate</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Scoring form */}
                  {hodSelectedCandidate ? (
                    <div className="space-y-4">
                      <p className="text-sm font-medium">Rating: {hodSelectedCandidate.name}</p>
                      <div className="space-y-4">
                        {(
                          [
                            ["technicalKnowledge", "Technical / Subject Knowledge"],
                            ["communicationSkills", "Communication Skills"],
                            ["teachingMethodology", "Teaching Methodology"],
                          ] as [keyof FeedbackForm["ratings"], string][]
                        ).map(([key, label]) => (
                          <RatingSelector
                            key={key}
                            label={label}
                            value={hodForm.ratings[key]}
                            onChange={(v) =>
                              setHodForm((f) => ({ ...f, ratings: { ...f.ratings, [key]: v } }))
                            }
                          />
                        ))}
                      </div>
                      <div className="space-y-2">
                        <Label>Recommendation</Label>
                        <Select
                          value={hodForm.recommendation}
                          onValueChange={(v) => setHodForm((f) => ({ ...f, recommendation: v as FeedbackForm["recommendation"] }))}
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
                          value={hodForm.strengths}
                          onChange={(e) => setHodForm((f) => ({ ...f, strengths: e.target.value }))}
                          placeholder="Key strengths observed..."
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Areas for Improvement (optional)</Label>
                        <Textarea
                          value={hodForm.weaknesses}
                          onChange={(e) => setHodForm((f) => ({ ...f, weaknesses: e.target.value }))}
                          placeholder="What could be improved..."
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Additional Comments (optional)</Label>
                        <Textarea
                          value={hodForm.comments}
                          onChange={(e) => setHodForm((f) => ({ ...f, comments: e.target.value }))}
                          placeholder="Any other observations..."
                          rows={2}
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => { setHodSelectedCandidate(null); setHodForm(defaultFeedback()); }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => void submitHodFeedback()} loading={isSubmittingHodFeedback}>
                          Submit Assessment
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
                      Select a candidate to submit your assessment.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ── STEP C: Panel scoring open — HOD sees summary ───────────────────────── */}
      {(batch.currentPhase === "PANEL_INTERVIEW" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED") && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Panel Interview Assessments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates.</p>
              ) : candidates.map((c) => {
                const feedbacks = panelFeedback.filter((f) => f.candidateId === c.id);
                const accepts = feedbacks.filter((f) => f.recommendation === "ACCEPT").length;
                const rejects = feedbacks.filter((f) => f.recommendation === "REJECT").length;
                const maybes = feedbacks.filter((f) => f.recommendation === "MAYBE").length;
                const total = batch.panelMemberUids.length;
                const submittedUids = new Set(feedbacks.map((f) => f.panelUid));
                const pendingUids = batch.panelMemberUids.filter((uid) => !submittedUids.has(uid));
                return (
                  <div key={c.id} className="p-3 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <div className="flex gap-3 text-xs mt-1">
                          <span className="flex items-center gap-1 text-green-600"><ThumbsUp className="h-3 w-3" />{accepts} Accept</span>
                          <span className="flex items-center gap-1 text-amber-600"><Minus className="h-3 w-3" />{maybes} Maybe</span>
                          <span className="flex items-center gap-1 text-red-600"><ThumbsDown className="h-3 w-3" />{rejects} Reject</span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{feedbacks.length}/{total} submitted</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                      {feedbacks.map((f) => (
                        <Badge key={f.panelUid} variant="outline" className="text-[11px] gap-1 text-green-700 border-green-300 bg-green-50">
                          <CheckCircle2 className="h-3 w-3" />
                          {userMap[f.panelUid]?.name ?? f.panelName}
                        </Badge>
                      ))}
                      {pendingUids.map((uid) => (
                        <Badge key={uid} variant="outline" className="text-[11px] gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {userMap[uid]?.name ?? "Unknown"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
              {batch.currentPhase === "PANEL_INTERVIEW" && (
                <p className="text-xs text-muted-foreground pt-1">
                  Panel members are submitting their assessments. Submit to Principal once all assessments are in.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Submit for Principal Final Review */}
          <Card className={batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED" ? "border-green-200 bg-green-50/40" : "border-primary/20"}>
            <CardContent className="p-5">
              {batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED" ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <div>
                    <p className="font-medium text-sm">Submitted for Principal review</p>
                    <p className="text-xs text-muted-foreground">The Principal will review all evaluations and make final hiring decisions.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">Submit All Evaluations to Principal</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Submit demo scores and panel assessments to the Principal for final hiring decisions.
                    </p>
                  </div>
                  <Button onClick={submitForPrincipalReview} loading={isSubmittingForReview} className="shrink-0">
                    Submit to Principal
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Pending demo message */}
      {batch.currentPhase === "INTERVIEW_READY" && (
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
