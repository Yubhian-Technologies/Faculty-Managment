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
import { auth } from "@/lib/firebase/client";
import { getOfferLetterPdfBase64 } from "@/lib/pdf/downloadOfferLetter";
import type { HiringBatch, Candidate } from "@/types";

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

export default function NewHodOfferLetterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetBatchId = searchParams.get("batchId");
  const presetCandidateId = searchParams.get("candidateId");
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [existingLetterCandidateIds, setExistingLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [sentConfirm, setSentConfirm] = useState<{ name: string; emailedTo?: string } | null>(null);
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });

  useEffect(() => {
    Promise.all([
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).then((d) => d.letters ?? []),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => (d.batches ?? []).filter((b) => b.currentPhase === "COMPLETED" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW")),
    ])
      .then(([lettersRes, batchRes]) => {
        setExistingLetterCandidateIds(new Set(lettersRes.map((l) => l.candidateId)));
        setBatches(batchRes);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }));
  }, []);

  useEffect(() => {
    collegeFetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name: string; address: string }>)
      .then((d) => setCollegeInfo({ name: d.name, address: d.address }))
      .catch(() => {});
  }, []);

  // Deep-linked from the pipeline's "Send Offer Letter" button — batch is already
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
      const data = await fetch(`/api/college/candidates?batchId=${batchId}&stage=DECISION`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>);
      const cands = data.candidates ?? [];
      setCandidates(cands.filter((c) => !existingLetterCandidateIds.has(c.id)));
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
      const data = await res.json() as { error?: string; ccEmails?: string[] };
      if (!res.ok) throw new Error(data.error ?? "Failed to send offer");

      let emailed = false;
      if (selectedCandidate?.email) {
        try {
          const token = await auth.currentUser?.getIdToken();
          if (token) {
            const letterFields = {
              candidateName: selectedCandidate.name,
              candidateAddress: selectedCandidate.permanentAddress || selectedCandidate.residenceAddress,
              designation,
              department,
              collegeName: collegeInfo.name,
              collegeAddress: collegeInfo.address,
              joiningDate,
              letterDate: new Date().toLocaleDateString("en-IN"),
              termsAndConditions: form.termsAndConditions,
            };
            const pdfBase64 = await getOfferLetterPdfBase64(letterFields);
            const emailRes = await fetch("/api/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                type: "OFFER_LETTER",
                to: selectedCandidate.email,
                cc: data.ccEmails ?? [],
                data: { ...letterFields, position: designation },
                pdfBase64,
              }),
            });
            emailed = emailRes.ok;
          }
        } catch {
          // Letter + faculty account are already created — email failure is surfaced via the dialog copy below, not a hard error.
        }
      }

      setSentConfirm({
        name: selectedCandidate?.name ?? "the candidate",
        emailedTo: emailed ? selectedCandidate?.email : undefined,
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
        description="Generate and email an offer letter to the candidate"
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
                      {b.position} — {b.department}
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
                        {c.name} — {c.email}
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
              <Button onClick={handleSend} loading={isSaving}>Send Offer Letter</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!sentConfirm} onOpenChange={(o) => { if (!o) { setSentConfirm(null); router.push("/hod/offers"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Offer Letter Sent</DialogTitle>
            <DialogDescription>
              {sentConfirm?.emailedTo
                ? <>The offer letter was emailed to <strong>{sentConfirm?.name}</strong> at <strong>{sentConfirm.emailedTo}</strong>, with the interview panel and office staff in CC.</>
                : <>The offer letter for <strong>{sentConfirm?.name}</strong> could not be emailed automatically — you can resend it from the Offer Letters list.</>}
              {" "}Once they accept, create their faculty account from the Offer Letters list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setSentConfirm(null); router.push("/hod/offers"); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
