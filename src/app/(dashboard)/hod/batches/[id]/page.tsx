"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle2,
  MapPin,
  Users,
  Star,
  Clock,
  ArrowRight,
  Pencil,
  Mail,
  Copy,
  FileCheck,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DOCUMENT_TYPE_GROUPS } from "@/lib/documentTypes";
import { DESIGNATION_LABELS, ROLE_LABELS, MEETING_PLATFORM_LABELS } from "@/types";
import type { HiringBatch, Candidate, CandidateApplication, CandidateBioData, InterviewMode, MeetingPlatform, FacultyMember, FMSUser } from "@/types";
import { useAuthStore } from "@/store/authStore";

// Joined view for this batch's roster: person fields come from Candidate,
// batch-cycle fields (arrival, interview mode) come from CandidateApplication.
// `id` is the applicationId (used for arrival PATCHes / call letter links);
// `candidateId` is the real Candidate id (used wherever panel feedback keys
// by candidate, since that schema wasn't changed by the decoupling).
type BatchCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  phone: string;
  resumeUrl?: string;
  hasArrived: boolean;
  interviewMode?: InterviewMode;
  bioData?: CandidateBioData;
  certificates?: Array<{ name: string; url: string }>;
  bioDataSubmitted?: boolean;
};

type PanelScores = {
  subjectKnowledge: number;
  presentationSkills: number;
  research: number;
  specificAttributes: number;
  others: number;
};

type PanelFeedbackItem = {
  id: string;
  candidateId: string;
  panelUid: string;
  panelName: string;
  panelScores?: PanelScores;
  recommendation?: "ACCEPT" | "REJECT" | "MAYBE";
  comments?: string;
};

// Panel rubric is marked out of 10 per criterion; a panelist's overall is the
// mean of their 5 criteria (also out of 10).
const PANEL_SCORE_LABELS: [keyof PanelScores, string][] = [
  ["subjectKnowledge", "Subject Knowledge"],
  ["presentationSkills", "Presentation"],
  ["research", "Research"],
  ["specificAttributes", "Specific Attributes"],
  ["others", "Others"],
];

const RECOMMENDATION_LABELS: Record<NonNullable<PanelFeedbackItem["recommendation"]>, string> = {
  ACCEPT: "Recommended",
  MAYBE: "With Reservations",
  REJECT: "Not Recommended",
};

function panelAvg(scores?: PanelScores): number | null {
  if (!scores) return null;
  const vals = PANEL_SCORE_LABELS.map(([k]) => scores[k]).filter((v) => typeof v === "number");
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

type StudentFeedbackSummary = {
  candidateId: string;
  count: number;
  averages: Record<string, number>;
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

export default function HODBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const myUid = useAuthStore((s) => s.user?.uid ?? "");
  const myDepartment = useAuthStore((s) => s.user?.department ?? "");

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<BatchCandidateView[]>([]);
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
  const [arrivingId, setArrivingId] = useState<string | null>(null);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  const [demoClassroom, setDemoClassroom] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingPlatform, setMeetingPlatform] = useState<MeetingPlatform | "">("");
  const [coordinatorFacultyId, setCoordinatorFacultyId] = useState("");
  const [interviewVenue, setInterviewVenue] = useState("");
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [newDoc, setNewDoc] = useState("");

  // Phase transitions
  const [isReleasingToPanel, setIsReleasingToPanel] = useState(false);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);

  async function load() {
    try {
      const [batchRes, applicationsRes, candidatesRes, facultyRes, usersRes, infoRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidate-applications?batchId=${id}`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch(`/api/college/candidates`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
        fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>),
        fetch("/api/college/users?allDepts=true&includeAll=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
        fetch("/api/college/info").then((r) => r.json() as Promise<{ name?: string }>),
      ]);
      setCollegeName(infoRes.name ?? "");
      const b = batchRes.batch;
      setBatch(b);
      const candidateMap = new Map((candidatesRes.candidates ?? []).map((c) => [c.id, c]));
      const cands: BatchCandidateView[] = (applicationsRes.applications ?? []).map((a) => {
        const person = candidateMap.get(a.candidateId);
        return {
          id: a.id,
          candidateId: a.candidateId,
          name: person?.name ?? "Unknown",
          email: person?.email ?? "",
          phone: person?.phone ?? "",
          resumeUrl: person?.resumeUrl,
          hasArrived: a.hasArrived,
          interviewMode: a.interviewMode,
          bioData: person?.bioData,
          certificates: person?.certificates,
          bioDataSubmitted: person?.bioDataSubmitted,
        };
      });
      setCandidates(cands);
      setFacultyList(facultyRes.faculty ?? []);
      const map: Record<string, FMSUser> = {};
      const users = usersRes.users ?? [];
      for (const u of users) map[u.uid] = u;
      setUserMap(map);
      setAllUsers(users);
      setDemoClassroom(b.demoClassroom ?? "");
      setMeetingLink(b.meetingLink ?? "");
      setMeetingPlatform(b.meetingPlatform ?? "");
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

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
        await load();
    })();
  }, [id]);

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
    const isOnline = batch?.hiringMode === "ONLINE";
    if (!isOnline && !coordinatorFacultyId) {
      toast({ variant: "destructive", title: "Please assign a coordinator" });
      return;
    }
    if (!isOnline && !interviewVenue.trim()) {
      toast({ variant: "destructive", title: "Please enter the interview venue" });
      return;
    }
    if (isOnline && (!meetingPlatform || !meetingLink.trim())) {
      toast({ variant: "destructive", title: "Please select a platform and enter a meeting link" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requiredDocuments,
          meetingLink: meetingLink.trim(),
          setupComplete: true,
          currentPhase: "INTERVIEW_READY",
          ...(isOnline
            ? { meetingPlatform }
            : { interviewVenue: interviewVenue.trim(), demoClassroom: demoClassroom.trim(), coordinatorFacultyId }),
        }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Setup saved",
        description: isOnline ? "Session is ready." : "Coordinator has been notified. Session is ready.",
      });
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

  // Online batches skip the physical demo/QR session entirely — "opening the
  // interview session" advances the batch directly (same PATCH the
  // coordinator's "Mark Demo Complete" makes), which is what reveals the
  // meeting link to panel members (see panel/interviews/[id]/page.tsx and
  // evaluation/[batchId]/[candidateId]/page.tsx, both gated on currentPhase
  // being IN_PROGRESS or later) without ever visiting /coordinator/[id].
  async function markInterviewComplete() {
    setIsMarkingComplete(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoComplete: true }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Interview session opened", description: "Panel members can now join the meeting and evaluate." });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setIsMarkingComplete(false);
    }
  }

  async function markArrived(applicationId: string) {
    if (arrivingId) return;
    setArrivingId(applicationId);
    try {
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasArrived: true }),
      });
      if (!res.ok) throw new Error();
      setCandidates((prev) => prev.map((c) => c.id === applicationId ? { ...c, hasArrived: true } : c));
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setArrivingId(null);
    }
  }

  function candidateFormUrl(candidate: BatchCandidateView) {
    return `${window.location.origin}/candidate-form/${batch?.collegeId}/${candidate.candidateId}?applicationId=${candidate.id}`;
  }

  function copyFormLink(candidate: BatchCandidateView) {
    void navigator.clipboard.writeText(candidateFormUrl(candidate));
    toast({ variant: "success", title: "Link copied" });
  }

  function sendCallLetter(candidate: BatchCandidateView) {
    if (!batch) return;

    const institution = collegeName || "Sri Vishnu Educational Society";
    const date = formatDate(batch.interviewDate);
    const time = batch.interviewTime || "To be notified";
    const venue = batch.interviewVenue || "To be notified";
    const mode = candidate.interviewMode === "ONLINE" ? "Online" : "Offline";
    const meetLink = batch.meetingLink || "";
    const platform = batch.meetingPlatform ? MEETING_PLATFORM_LABELS[batch.meetingPlatform] : "";
    // Coordinator contact - best-effort; omit whichever of phone/email is
    // missing, and skip the whole block if there's no coordinator at all
    // (online batches have none, so this naturally disappears for them).
    const coordinator = batch.coordinatorUid ? userMap[batch.coordinatorUid] : undefined;
    const coordinatorLines = [
      batch.coordinatorName,
      coordinator?.phone ? `Phone: ${coordinator.phone}` : "",
      coordinator?.email ? `Email: ${coordinator.email}` : "",
    ].filter(Boolean);
    const coordinatorBlock = coordinatorLines.length > 0
      ? `\n\nFor any queries, please contact your Interview Coordinator:\n${coordinatorLines.join("\n")}`
      : "";
    const docs = (batch.requiredDocuments ?? []).length > 0
      ? (batch.requiredDocuments ?? []).map((d) => `• ${d}`).join("\n")
      : "• Updated Resume/Curriculum Vitae\n• Passport-size Photograph\n• Original and Photocopies of Educational Certificates\n• Experience Certificates (if applicable)\n• Government-issued Photo ID Proof";

    const body = `Dear Dr./Mr./Ms. ${candidate.name},

Greetings from ${institution}.

Thank you for your interest in joining our institution. Based on your application and profile, we are pleased to invite you to attend an interview for the position of Faculty – ${batch.department}.

INTERVIEW DETAILS:

• Date: ${date}
• Time: ${time}
• Mode: ${mode}${mode === "Online"
      ? `${platform ? `\n• Platform: ${platform}` : ""}${meetLink ? `\n• Meeting Link: ${meetLink}` : ""}\n• Please join a few minutes before the scheduled time`
      : `\n• Venue: ${venue}\n• Reporting Time: Please arrive 15 minutes before the scheduled time`}${coordinatorBlock}

Kindly bring the following documents for verification:

${docs}
• Any other relevant supporting documents

Please complete your bio-data form and upload your certificates before the interview:
${candidateFormUrl(candidate)}

Please confirm your availability by replying to this email.

Contact Person: ${batch.hodName}

We look forward to meeting you and discussing how your skills and experience can contribute to our institution.

Thank you, and we wish you all the best.

Warm regards,

${batch.hodName}
Head of Department – ${batch.department}
${institution}`;

    // CC: Principal, Vice Principal, College Office, and this batch's selected panel members
    const panelEmails = batch.panelMemberUids.map((uid) => userMap[uid]?.email).filter(Boolean) as string[];
    const ccEmails = Array.from(new Set([
      ...allUsers
        .filter((u) => u.role === "PRINCIPAL" || u.role === "VICE_PRINCIPAL" || u.role === "COLLEGE_OFFICE")
        .map((u) => u.email)
        .filter(Boolean),
      ...panelEmails,
    ])).join(",");

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

            {/* Venue (offline only) */}
            {batch.hiringMode !== "ONLINE" && (
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
            )}

            {/* Required Documents */}
            <div className="space-y-2">
              <Label>Required Documents <span className="font-normal text-muted-foreground">(candidates must bring)</span></Label>
              <Select
                value=""
                onValueChange={(doc) => {
                  if (!requiredDocuments.includes(doc)) {
                    setRequiredDocuments((prev) => [...prev, doc]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a document to add..." />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPE_GROUPS.map((group) => (
                    <SelectGroup key={group.category}>
                      <SelectLabel>{group.category}</SelectLabel>
                      {group.items.map((item) => (
                        <SelectItem key={item} value={item} disabled={requiredDocuments.includes(item)}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input
                  value={newDoc}
                  onChange={(e) => setNewDoc(e.target.value)}
                  placeholder="Other document not listed above..."
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
                        aria-label={`Remove ${doc}`}
                        className="ml-0.5 text-muted-foreground hover:text-destructive text-base leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {batch.hiringMode === "ONLINE" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="meetingPlatform">Platform *</Label>
                  <Select value={meetingPlatform} onValueChange={(v) => setMeetingPlatform(v as MeetingPlatform)}>
                    <SelectTrigger id="meetingPlatform">
                      <SelectValue placeholder="Select a platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MEETING_PLATFORM_LABELS) as MeetingPlatform[]).map((p) => (
                        <SelectItem key={p} value={p}>{MEETING_PLATFORM_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meetingLink">Meeting Link *</Label>
                  <Input
                    id="meetingLink"
                    type="url"
                    value={meetingLink}
                    onChange={(e) => setMeetingLink(e.target.value)}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  />
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}

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
              Click to open Gmail with a pre-filled call letter. Principal, Vice Principal, College Office, and the selected panel members will be automatically added to CC.
            </p>
            <div className="space-y-2">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border bg-white">
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </div>
                  {c.bioDataSubmitted ? (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />Form submitted
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => copyFormLink(c)}>
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy Link
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendCallLetter(c)}>
                        <Mail className="h-3.5 w-3.5 mr-1.5" />
                        Send Call Letter
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Candidate Bio Data — submissions from the public candidate-form link */}
      {batch.setupComplete && candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-primary" />
              Candidate Bio Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidates.map((c) => {
              const bd = c.bioData;
              const fields: [string, string | undefined][] = bd
                ? [
                    ["Father's Name", bd.fatherName],
                    ["Mother's Name", bd.motherName],
                    ["Date of Birth", bd.dateOfBirth],
                    ["Gender", bd.gender],
                    ["Marital Status", bd.maritalStatus],
                    ["Spouse Name", bd.spouseName],
                    ["Aadhaar No.", bd.aadharNo],
                    ["PAN No.", bd.panNo],
                    ["Blood Group", bd.bloodGroup],
                    ["Emergency Contact", bd.emergencyContactName && bd.emergencyContactPhone ? `${bd.emergencyContactName} (${bd.emergencyContactPhone})` : undefined],
                    ["Current Employer", bd.currentEmployer],
                    ["Total Experience", bd.totalExperienceYears ? `${bd.totalExperienceYears} yrs` : undefined],
                    ["Current CTC", bd.currentCTC],
                    ["Expected CTC", bd.expectedCTC],
                    ["Notice Period", bd.noticePeriod],
                    ["References", bd.references],
                    ["Additional Info", bd.additionalInfo],
                  ]
                : [];
              return (
                <div key={c.id} className="p-3 rounded-lg border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{c.name}</p>
                    {c.bioDataSubmitted ? (
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />Submitted
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />Pending
                      </span>
                    )}
                  </div>
                  {c.bioDataSubmitted && (
                    <>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 text-xs">
                        {fields.filter(([, v]) => v).map(([label, value]) => (
                          <div key={label}>
                            <p className="text-muted-foreground">{label}</p>
                            <p className="font-medium">{value}</p>
                          </div>
                        ))}
                      </div>
                      {(c.certificates ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t">
                          {(c.certificates ?? []).map((cert, i) => (
                            <a
                              key={i}
                              href={cert.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary underline"
                            >
                              {cert.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
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
                    ) : c.bioDataSubmitted ? (
                      <Button size="sm" variant="outline" loading={arrivingId === c.id} disabled={!!arrivingId} onClick={() => void markArrived(c.id)}>
                        Mark Arrived
                      </Button>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground flex items-center gap-1"
                        title="The candidate's bio data form hasn't been submitted yet — review it in Candidate Bio Data above before marking them arrived"
                      >
                        <Clock className="h-3 w-3" />Awaiting bio data form
                      </span>
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
                    allUsers
                      // Hide other departments' faculty from the picker - keep
                      // Principal/VP (college-wide defaults) and anyone already
                      // on this batch's panel (so existing picks don't vanish).
                      .filter(
                        (u) =>
                          u.role === "PRINCIPAL" ||
                          u.role === "VICE_PRINCIPAL" ||
                          u.department === myDepartment ||
                          editPanel.includes(u.uid)
                      )
                      .map((u) => (
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


      {/* ── STEP A: Demo complete — HOD reviews student scores (offline only, no demo/QR for online interviews) ── */}
      {batch.hiringMode !== "ONLINE" && (batch.currentPhase === "IN_PROGRESS" || batch.currentPhase === "PANEL_INTERVIEW" || batch.currentPhase === "PRINCIPAL_FINAL_REVIEW" || batch.currentPhase === "COMPLETED") && (
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
                  const sf = studentFeedbackSummary.find((s) => s.candidateId === c.candidateId);
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

      {/* ── Panel scores + student feedback + overall, per candidate ──────────── */}
      {["PANEL_INTERVIEW", "PRINCIPAL_FINAL_REVIEW", "COMPLETED"].includes(batch.currentPhase) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-primary" />
              Panel Evaluation &amp; Overall Score
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {candidates.map((c) => {
              const rows = panelFeedback.filter((f) => f.candidateId === c.candidateId && f.panelScores);
              const panelAverages = rows.map((r) => panelAvg(r.panelScores)).filter((v): v is number => v != null);
              const panelOverall = panelAverages.length ? panelAverages.reduce((a, b) => a + b, 0) / panelAverages.length : null;
              const sf = studentFeedbackSummary.find((s) => s.candidateId === c.candidateId);
              const studentVals = sf ? Object.values(sf.averages) : [];
              const studentOverall = sf
                ? (sf.averages.overallImpression ?? (studentVals.length ? studentVals.reduce((a, b) => a + b, 0) / studentVals.length : null))
                : null;
              // Normalize both signals to /10 (student rubric is out of 5) and
              // average whichever are available into a single overall.
              const overallParts: number[] = [];
              if (panelOverall != null) overallParts.push(panelOverall);
              if (studentOverall != null) overallParts.push(studentOverall * 2);
              const overall10 = overallParts.length ? overallParts.reduce((a, b) => a + b, 0) / overallParts.length : null;
              return (
                <div key={c.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">{c.name}</p>
                    {overall10 != null ? (
                      <div className="text-right">
                        <span className="text-lg font-semibold text-primary">{overall10.toFixed(1)}</span>
                        <span className="text-xs text-muted-foreground"> /10 overall</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No scores yet</span>
                    )}
                  </div>

                  {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No panel evaluations submitted yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground text-left">
                            <th className="py-1 pr-3 font-medium">Panel Member</th>
                            {PANEL_SCORE_LABELS.map(([k, label]) => (
                              <th key={k} className="py-1 px-2 font-medium text-center">{label}</th>
                            ))}
                            <th className="py-1 px-2 font-medium text-center">Avg</th>
                            <th className="py-1 pl-2 font-medium">Recommendation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const avg = panelAvg(r.panelScores);
                            return (
                              <tr key={r.id} className="border-t">
                                <td className="py-1.5 pr-3 font-medium">{r.panelName}</td>
                                {PANEL_SCORE_LABELS.map(([k]) => (
                                  <td key={k} className="py-1.5 px-2 text-center">{r.panelScores?.[k] ?? "-"}</td>
                                ))}
                                <td className="py-1.5 px-2 text-center font-semibold">{avg != null ? avg.toFixed(1) : "-"}</td>
                                <td className="py-1.5 pl-2">
                                  {r.recommendation ? (
                                    <Badge variant="outline" className="text-[10px]">{RECOMMENDATION_LABELS[r.recommendation]}</Badge>
                                  ) : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4 text-xs pt-2 border-t">
                    <span className="text-muted-foreground">Panel avg: <span className="font-semibold text-foreground">{panelOverall != null ? `${panelOverall.toFixed(1)}/10` : "—"}</span></span>
                    <span className="text-muted-foreground">Student feedback: <span className="font-semibold text-foreground">{studentOverall != null ? `${studentOverall.toFixed(1)}/5 · ${sf?.count ?? 0} response${(sf?.count ?? 0) !== 1 ? "s" : ""}` : "—"}</span></span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── STEP B: HOD releases to panel interview scoring ─────────────────────── */}
      {batch.currentPhase === "IN_PROGRESS" && (
        <Card className="border-primary/30">
          <CardContent className="p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">{batch.hiringMode === "ONLINE" ? "Open for Evaluations" : "Release for Panel Interview Scoring"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {batch.hiringMode === "ONLINE"
                  ? "Once the panel has finished interviewing candidates over the meeting link, open evaluations so they can submit their assessments."
                  : "Once you review the demo scores above, open panel scoring so all panel members can submit their interview assessments."}
              </p>
            </div>
            <Button onClick={() => void releaseToPanelInterview()} loading={isReleasingToPanel} className="shrink-0">
              <ArrowRight className="h-4 w-4 mr-2" />
              {batch.hiringMode === "ONLINE" ? "Open for Evaluations" : "Open Panel Scoring"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── HOD's own assessment — shown when HOD is also a panel member ──────── */}
      {batch.currentPhase === "PANEL_INTERVIEW" && (batch.panelMemberUids as string[]).includes(myUid) && (() => {
        const hodSubmittedFor = panelFeedback.filter((f) => f.panelUid === myUid).map((f) => f.candidateId);
        const allDone = candidates.length > 0 && candidates.every((c) => hodSubmittedFor.includes(c.candidateId));
        return (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                My Evaluation
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allDone ? (
                <div className="flex items-center gap-2 text-sm text-green-600 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  You have submitted your assessment for all {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}.
                </div>
              ) : (
                <div className="space-y-2">
                  {candidates.map((c) => {
                    const done = hodSubmittedFor.includes(c.candidateId);
                    const row = (
                      <div
                        className={`p-3 rounded-lg border transition-colors ${
                          done
                            ? "bg-green-50 border-green-200 cursor-default"
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
                              <CheckCircle2 className="h-3 w-3" />Submitted
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs">Rate</Badge>
                          )}
                        </div>
                      </div>
                    );
                    return done ? (
                      <div key={c.id}>{row}</div>
                    ) : (
                      <Link key={c.id} href={`/evaluation/${id}/${c.candidateId}`}>
                        {row}
                      </Link>
                    );
                  })}
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
              <CardTitle className="text-base">Panel Evaluations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates.</p>
              ) : candidates.map((c) => {
                const feedbacks = panelFeedback.filter((f) => f.candidateId === c.candidateId);
                const total = batch.panelMemberUids.length;
                const submittedUids = new Set(feedbacks.map((f) => f.panelUid));
                const pendingUids = batch.panelMemberUids.filter((uid) => !submittedUids.has(uid));
                return (
                  <div key={c.id} className="p-3 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{c.name}</p>
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

      {/* Once a candidate has arrived, open the interview session directly —
          no need to wait for a separate demo day. Online batches have no
          physical demo/QR session at all, so they get a direct fast-forward
          instead of a link to /coordinator. */}
      {batch.currentPhase === "INTERVIEW_READY" && (
        <Card className={candidates.some((c) => c.hasArrived) ? "border-primary/30" : "border-dashed"}>
          <CardContent className="p-6 text-center">
            {candidates.some((c) => c.hasArrived) ? (
              batch.hiringMode === "ONLINE" ? (
                <>
                  <p className="font-medium text-sm">Candidates are ready</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Open the interview session to reveal the meeting link to panel members so they can join and interview candidates.
                  </p>
                  <Button onClick={() => void markInterviewComplete()} loading={isMarkingComplete}>
                    Open Interview Session
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium text-sm">Candidates are arriving</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Open the interview session to display demo QR codes and run scoring.
                  </p>
                  <Button asChild>
                    <Link href={`/coordinator/${id}`}>
                      Open Demo Session
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </>
              )
            ) : (
              <>
                <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-sm">Waiting for candidates to arrive</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Mark candidates arrived above, then {batch.hiringMode === "ONLINE" ? "open the interview session" : "open the interview session to run the demo and scoring"}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
