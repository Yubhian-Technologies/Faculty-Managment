"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate } from "@/lib/utils";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { useAuthStore } from "@/store/authStore";
import type { HiringBatch, Candidate, CandidateApplication } from "@/types";

// Dropdown option for a DECISION-stage candidate in this batch. `id` is the
// real Candidate id (what OfferLetter.candidateId expects) — negotiatedSalary/
// dateOfJoining/termsAndConditions/expectedSalary come from the candidate's
// CandidateApplication (Principal-set at decision time), person fields from
// the Candidate itself.
type BatchCandidateOption = {
  id: string;
  name: string;
  email: string;
  permanentAddress?: string;
  residenceAddress?: string;
  expectedSalary?: number;
  negotiatedSalary?: number;
  dateOfJoining?: string;
  termsAndConditions?: string[];
};

type CreateForm = {
  batchId: string;
  candidateId: string;
  designation: string;
  department: string;
  joiningDate: string;
  ctcAnnual: string;
  subjects: string;
  termsAndConditions: string;
};

const emptyForm = (): CreateForm => ({
  batchId: "", candidateId: "", designation: "", department: "", joiningDate: "",
  ctcAnnual: "", subjects: "", termsAndConditions: "",
});

export default function NewCollegeOfficeOfferLetterPage() {
  const router = useRouter();
  const collegeId = useAuthStore((s) => s.user?.collegeId);
  const searchParams = useSearchParams();
  const presetBatchId = searchParams.get("batchId");
  const presetCandidateId = searchParams.get("candidateId");
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<BatchCandidateOption[]>([]);
  const [existingLetterCandidateIds, setExistingLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [sentConfirm, setSentConfirm] = useState<{ name: string; emailedTo?: string } | null>(null);
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });

  function loadBatchesAndLetters() {
    return Promise.all([
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string; status?: string }[] }>).then((d) => d.letters ?? []),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => (d.batches ?? []).filter((b) => b.currentPhase === "COMPLETED" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW")),
    ])
      .then(([lettersRes, batchRes]) => {
        // A REJECTED offer shouldn't block a fresh one — the office dashboard
        // explicitly lets a candidate be re-offered after a rejected offer.
        setExistingLetterCandidateIds(new Set(lettersRes.filter((l) => l.status !== "REJECTED").map((l) => l.candidateId)));
        setBatches(batchRes);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }));
  }

  useEffect(() => { void loadBatchesAndLetters(); }, []);

  // Principal's decision (which makes a batch/candidate eligible here) happens
  // server-side in a different session — refetch on refocus so office staff
  // don't sit behind a stale snapshot from before the decision was made.
  useEffect(() => {
    function onFocus() {
      void loadBatchesAndLetters();
      if (form.batchId) void loadCandidatesForBatch(form.batchId);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.batchId]);

  useEffect(() => {
    collegeFetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name: string; address: string }>)
      .then((d) => setCollegeInfo({ name: d.name, address: d.address }))
      .catch(() => {});
  }, []);

  // Deep-linked from the pipeline's "Send Offer Letter" button - batch is already
  // known, so skip the manual selection step once batches have loaded.
  useEffect(() => {
    if (presetBatchId && !form.batchId && batches.some((b) => b.id === presetBatchId)) {
      handleBatchChange(presetBatchId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, presetBatchId]);

  // Also deep-linked with the candidate already known (e.g. Principal's decision
  // page) — auto-select once the batch's candidate list has loaded.
  useEffect(() => {
    if (presetCandidateId && !form.candidateId && candidates.some((c) => c.id === presetCandidateId)) {
      handleCandidateChange(presetCandidateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, presetCandidateId]);

  async function loadCandidatesForBatch(batchId: string) {
    setLoadingCandidates(true);
    try {
      const [appsData, candsData] = await Promise.all([
        fetch(`/api/college/candidate-applications?batchId=${batchId}&stage=DECISION`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch(`/api/college/candidates`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      ]);
      const personMap = new Map((candsData.candidates ?? []).map((c) => [c.id, c]));
      const opts: BatchCandidateOption[] = (appsData.applications ?? [])
        .filter((a) => !existingLetterCandidateIds.has(a.candidateId))
        .map((a) => {
          const person = personMap.get(a.candidateId);
          return {
            id: a.candidateId,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            permanentAddress: person?.permanentAddress,
            residenceAddress: person?.residenceAddress,
            expectedSalary: a.expectedSalary,
            negotiatedSalary: a.negotiatedSalary,
            dateOfJoining: a.dateOfJoining,
            termsAndConditions: a.termsAndConditions,
          };
        });
      setCandidates(opts);
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function handleBatchChange(batchId: string) {
    const batch = batches.find((b) => b.id === batchId);
    setForm((f) => ({
      ...f,
      batchId,
      candidateId: "",
      designation: batch?.position ?? f.designation,
      department: batch?.department ?? f.department,
    }));
    void loadCandidatesForBatch(batchId);
  }

  function handleCandidateChange(candidateId: string) {
    const candidate = candidates.find((c) => c.id === candidateId);
    setForm((f) => ({
      ...f,
      candidateId,
      // Negotiated salary and date of joining are captured by the Principal at
      // decision time — auto-fill here rather than re-asking for them.
      ctcAnnual: candidate?.negotiatedSalary != null ? String(candidate.negotiatedSalary) : f.ctcAnnual,
      joiningDate: candidate?.dateOfJoining ?? f.joiningDate,
      // Terms the Principal ticked at decision time — still editable here before sending.
      termsAndConditions: candidate?.termsAndConditions?.length ? candidate.termsAndConditions.join("\n") : f.termsAndConditions,
    }));
  }

  async function handleSend() {
    const { batchId, candidateId, designation, department, joiningDate, ctcAnnual } = form;
    if (!batchId || !candidateId || !designation || !department || !joiningDate || !ctcAnnual) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const selectedCandidate = candidates.find((c) => c.id === candidateId);
      const res = await fetch("/api/college/offer-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          batchId,
          candidateName: selectedCandidate?.name ?? "",
          designation,
          department,
          joiningDate,
          ctcAnnual: Number(ctcAnnual),
          subjects: form.subjects.split(",").map((s) => s.trim()).filter(Boolean),
          termsAndConditions: form.termsAndConditions,
        }),
      });
      const data = await res.json() as { id?: string; error?: string; ccEmails?: string[] };
      if (!res.ok) throw new Error(data.error ?? "Failed to send offer");

      const batch = batches.find((b) => b.id === batchId);
      const letterFields = {
        candidateName: selectedCandidate?.name ?? "",
        candidateAddress: selectedCandidate?.permanentAddress || selectedCandidate?.residenceAddress,
        designation,
        department,
        collegeName: collegeInfo.name,
        collegeAddress: collegeInfo.address,
        interviewDate: batch?.interviewDate ? formatDate(batch.interviewDate) : undefined,
        joiningDate,
        letterDate: new Date().toLocaleDateString("en-IN"),
        termsAndConditions: form.termsAndConditions,
      };

      // Office reviews and sends the mail themselves (Gmail compose draft) rather
      // than the backend sending it directly — the PDF is downloaded for them to attach.
      await downloadOfferLetterPdf(letterFields, selectedCandidate?.name ?? candidateId);

      if (selectedCandidate?.email) {
        const institution = collegeInfo.name || "the institution";
        const acceptanceUrl = collegeId && data.id ? `${window.location.origin}/offer-acceptance/${collegeId}/${data.id}` : "";
        const subject = `Offer Letter – ${designation} | ${institution}`;
        const body = `Dear ${selectedCandidate.name},

Greetings from ${institution}.

We are pleased to offer you the position of ${designation} in the ${department} department, effective from ${new Date(joiningDate).toLocaleDateString("en-IN")}.

The offer letter PDF has just been downloaded to your computer - please attach it to this email before sending.
${acceptanceUrl ? `\nPlease review the Terms & Conditions and confirm your acceptance and date of joining here:\n${acceptanceUrl}\n` : ""}
Congratulations, and welcome aboard!

Warm regards,
${institution}`;
        const cc = (data.ccEmails ?? []).join(",");
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selectedCandidate.email)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, "_blank");
      }

      setSentConfirm({
        name: selectedCandidate?.name ?? "the candidate",
        emailedTo: selectedCandidate?.email,
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to send offer", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Send Offer Letter"
        description="Generate the offer letter and open a composed email draft to review before sending"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Finalized Batch *</Label>
              <Select value={form.batchId} onValueChange={handleBatchChange} disabled={!!presetBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder={batches.length === 0 ? "No eligible batches" : "Select batch..."} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.position} - {b.department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.batchId && (
              <div className="space-y-2">
                <Label>Candidate *</Label>
                <Select value={form.candidateId} onValueChange={handleCandidateChange} disabled={loadingCandidates}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCandidates ? "Loading..." : candidates.length === 0 ? "No eligible candidates" : "Select candidate..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} - {c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Assistant Professor" />
              </div>
              <div className="space-y-2">
                <Label>Department *</Label>
                <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Computer Science" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Joining Date *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Annual CTC (₹) *</Label>
                <Input type="number" min="0" value={form.ctcAnnual} onChange={(e) => setForm((f) => ({ ...f, ctcAnnual: e.target.value }))} placeholder="e.g. 600000" />
                {(() => {
                  const candidate = candidates.find((c) => c.id === form.candidateId);
                  if (candidate?.expectedSalary == null) return null;
                  return (
                    <p className="text-xs text-muted-foreground">
                      Candidate&rsquo;s expected salary: ₹{candidate.expectedSalary.toLocaleString("en-IN")}/yr (for reference only — not shown on the offer letter)
                    </p>
                  );
                })()}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Subjects (comma-separated)</Label>
              <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Data Structures, Algorithms" />
            </div>

            <div className="space-y-2">
              <Label>Terms &amp; Conditions</Label>
              <Textarea
                value={form.termsAndConditions}
                onChange={(e) => setForm((f) => ({ ...f, termsAndConditions: e.target.value }))}
                placeholder={"One per line, e.g.\nThis appointment is on a probationary basis for one year.\nSubject to the institution's service rules and regulations."}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">Included in the offer letter and email. One condition per line.</p>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSend} loading={isSaving}>Generate &amp; Compose Email</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!sentConfirm} onOpenChange={(o) => { if (!o) { setSentConfirm(null); router.push("/college-office/offers"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Offer Letter Generated</DialogTitle>
            <DialogDescription>
              {sentConfirm?.emailedTo
                ? <>The offer letter PDF has been downloaded, and a Gmail draft to <strong>{sentConfirm?.name}</strong> at <strong>{sentConfirm.emailedTo}</strong> (CC: Principal, Vice Principal, panel members, HOD, and Accounts) has opened in a new tab — attach the PDF and review before sending.</>
                : <>The offer letter PDF has been downloaded. <strong>{sentConfirm?.name}</strong> has no email on file, so you&apos;ll need to send it manually.</>}
              {" "}Once they accept, mark it from this list, then Request Credentials — the Webmaster will provision their account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setSentConfirm(null); router.push("/college-office/offers"); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
