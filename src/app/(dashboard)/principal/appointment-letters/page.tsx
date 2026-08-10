"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { downloadAppointmentLetterPdf } from "@/lib/pdf/downloadAppointmentLetter";
import { ChevronDown, ChevronUp, FileText, Download, Mail, CheckCircle2 } from "lucide-react";
import type { Candidate, CandidateApplication, OfferLetter } from "@/types";

type FormState = { designation: string; department: string; joiningDate: string };

// Joined view: application (per-hiring-request document/decision state) +
// candidate (person) fields. `id` is the applicationId; `candidateId` is the
// real Candidate id (OfferLetter/AppointmentLetter are still keyed by it).
type AppointmentCandidateView = {
  id: string;
  candidateId: string;
  batchId: string;
  name: string;
  email: string;
  position: string;
  department: string;
  dateOfJoining?: string;
};

export default function PrincipalAppointmentLettersPage() {
  const [candidates, setCandidates] = useState<AppointmentCandidateView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(new Set());
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });

  async function load() {
    setIsLoading(true);
    try {
      const [applicationsRes, candidatesRes, offersRes, appointmentsRes] = await Promise.all([
        fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
        fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>),
        fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string; batchId: string }[] }>),
      ]);
      // Offer/appointment letters are still keyed by (candidateId, batchId) directly
      // (unchanged schema) — match on that pair since one candidate can have
      // independent applications/offers across multiple hiring batches.
      const acceptedKeys = new Set(
        (offersRes.letters ?? []).filter((l) => l.status === "ACCEPTED").map((l) => `${l.candidateId}:${l.batchId}`)
      );
      const alreadyGeneratedKeys = new Set(
        (appointmentsRes.letters ?? []).map((l) => `${l.candidateId}:${l.batchId}`)
      );
      const candidateMap = new Map((candidatesRes.candidates ?? []).map((c) => [c.id, c]));
      const eligible: AppointmentCandidateView[] = (applicationsRes.applications ?? [])
        .filter((a) => a.joiningLetterUrl && a.batchId && acceptedKeys.has(`${a.candidateId}:${a.batchId}`) && !alreadyGeneratedKeys.has(`${a.candidateId}:${a.batchId}`))
        .map((a) => {
          const person = candidateMap.get(a.candidateId);
          return {
            id: a.id,
            candidateId: a.candidateId,
            batchId: a.batchId ?? "",
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            position: a.position,
            department: a.department,
            dateOfJoining: a.dateOfJoining,
          };
        });
      setCandidates(eligible);
      setForms(
        Object.fromEntries(
          eligible.map((c) => [c.id, {
            designation: c.position,
            department: c.department,
            joiningDate: c.dateOfJoining ?? "",
          }])
        )
      );
    } catch {
      toast({ variant: "destructive", title: "Failed to load candidates" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    collegeFetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name: string; address: string }>)
      .then((d) => setCollegeInfo({ name: d.name, address: d.address }))
      .catch(() => {});
  }, []);

  async function generateAndRelease(candidate: AppointmentCandidateView) {
    const form = forms[candidate.id];
    if (!form?.designation || !form.department || !form.joiningDate) {
      toast({ variant: "destructive", title: "Fill in designation, department, and joining date" });
      return;
    }
    setGeneratingId(candidate.id);
    try {
      const res = await fetch("/api/college/appointment-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          batchId: candidate.batchId,
          candidateName: candidate.name,
          designation: form.designation,
          department: form.department,
          joiningDate: form.joiningDate,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");

      const letterFields = {
        candidateName: candidate.name,
        designation: form.designation,
        department: form.department,
        collegeName: collegeInfo.name,
        collegeAddress: collegeInfo.address,
        joiningDate: formatDate(new Date(form.joiningDate)),
        letterDate: formatDate(new Date()),
      };

      // Principal reviews and sends the mail themselves (Gmail compose draft) rather
      // than the backend sending it directly — the PDF is downloaded for them to attach.
      await downloadAppointmentLetterPdf(letterFields, candidate.name);

      let composed = false;
      if (candidate.email) {
        const institution = collegeInfo.name || "the institution";
        const subject = `Appointment Letter – ${form.designation} | ${institution}`;
        const body = `Dear ${candidate.name},

Congratulations! Please find attached your formal appointment letter for the position of ${form.designation} in the ${form.department} department, effective from ${formatDate(new Date(form.joiningDate))}.

The appointment letter PDF has just been downloaded to your computer - please attach it to this email before sending.

Warm regards,
${institution}`;
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(candidate.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, "_blank");
        composed = true;
      }

      toast({
        variant: "success",
        title: "Appointment letter generated",
        description: composed ? `Gmail draft opened for ${candidate.email} — attach the downloaded PDF and send.` : "Candidate has no email on file - download and send it manually.",
      });
      setGeneratedIds((prev) => new Set(prev).add(candidate.id));
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate appointment letter", description: err instanceof Error ? err.message : undefined });
    } finally {
      setGeneratingId(null);
    }
  }

  async function downloadPdf(candidate: AppointmentCandidateView) {
    const form = forms[candidate.id];
    if (!form) return;
    await downloadAppointmentLetterPdf(
      {
        candidateName: candidate.name,
        designation: form.designation,
        department: form.department,
        collegeName: collegeInfo.name,
        collegeAddress: collegeInfo.address,
        joiningDate: formatDate(new Date(form.joiningDate)),
        letterDate: formatDate(new Date()),
      },
      candidate.name
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Appointment Letters" description="Loading..." />
        <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointment Letters"
        description="Generate and release the formal appointment letter once the joining letter has been uploaded"
      />

      {candidates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No candidates ready yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Candidates appear here once the office has uploaded their joining letter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const isExpanded = expandedId === candidate.id;
            const form = forms[candidate.id];
            const isGenerating = generatingId === candidate.id;
            const isDone = generatedIds.has(candidate.id);

            return (
              <Card key={candidate.id}>
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : candidate.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{candidate.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{candidate.position} · {candidate.department}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDone && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />Released
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && form && (
                  <CardContent className="pt-0 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Designation</Label>
                        <Input value={form.designation} onChange={(e) => setForms((p) => ({ ...p, [candidate.id]: { ...p[candidate.id], designation: e.target.value } }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Department</Label>
                        <Input value={form.department} onChange={(e) => setForms((p) => ({ ...p, [candidate.id]: { ...p[candidate.id], department: e.target.value } }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Joining Date</Label>
                        <Input type="date" value={form.joiningDate} onChange={(e) => setForms((p) => ({ ...p, [candidate.id]: { ...p[candidate.id], joiningDate: e.target.value } }))} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button size="sm" variant="outline" onClick={() => void downloadPdf(candidate)}>
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Download PDF
                      </Button>
                      <Button size="sm" loading={isGenerating} disabled={isDone} onClick={() => void generateAndRelease(candidate)}>
                        <Mail className="h-3.5 w-3.5 mr-1" />
                        {isDone ? "Released" : "Generate & Compose Email"}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
