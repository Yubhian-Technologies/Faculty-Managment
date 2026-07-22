"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { Wand2 } from "lucide-react";
import type { HiringBatch, Candidate } from "@/types";

type CreateForm = {
  batchId: string;
  candidateId: string;
  designation: string;
  department: string;
  joiningDate: string;
  ctcAnnual: string;
  subjects: string;
  facultyEmail: string;
  facultyPassword: string;
};

const emptyForm = (): CreateForm => ({
  batchId: "", candidateId: "", designation: "", department: "", joiningDate: "",
  ctcAnnual: "", subjects: "", facultyEmail: "", facultyPassword: "",
});

function randomPassword(): string {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function NewHodOfferLetterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetBatchId = searchParams.get("batchId");
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [existingLetterCandidateIds, setExistingLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [sentConfirm, setSentConfirm] = useState<{ name: string; email: string } | null>(null);

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

  // Deep-linked from the pipeline's "Send Offer Letter" button — batch is already
  // known, so skip the manual selection step once batches have loaded.
  useEffect(() => {
    if (presetBatchId && !form.batchId && batches.some((b) => b.id === presetBatchId)) {
      handleBatchChange(presetBatchId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, presetBatchId]);

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
    setForm((f) => ({ ...f, candidateId, facultyEmail: f.facultyEmail || candidate?.email || "" }));
  }

  async function handleSend() {
    const { batchId, candidateId, designation, department, joiningDate, ctcAnnual, facultyEmail, facultyPassword } = form;
    if (!batchId || !candidateId || !designation || !department || !joiningDate || !ctcAnnual || !facultyEmail || !facultyPassword) {
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
          facultyEmail,
          facultyPassword,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to send offer");
      setSentConfirm({ name: selectedCandidate?.name ?? "the candidate", email: facultyEmail });
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
        description="Generate and send an offer letter, and create the faculty's login in one step"
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
              </div>
            </div>

            <div className="space-y-2">
              <Label>Subjects (comma-separated)</Label>
              <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Data Structures, Algorithms" />
            </div>

            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Faculty Login</p>
              <div className="space-y-2">
                <Label>Login Email *</Label>
                <Input type="email" value={form.facultyEmail} onChange={(e) => setForm((f) => ({ ...f, facultyEmail: e.target.value }))} placeholder="faculty@college.edu" />
              </div>
              <div className="space-y-2">
                <Label>Password *</Label>
                <div className="flex gap-2">
                  <Input value={form.facultyPassword} onChange={(e) => setForm((f) => ({ ...f, facultyPassword: e.target.value }))} placeholder="Set a login password" />
                  <Button type="button" variant="outline" size="icon" title="Generate password" onClick={() => setForm((f) => ({ ...f, facultyPassword: randomPassword() }))}>
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
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
            <DialogTitle>Offer Sent & Faculty Account Created</DialogTitle>
            <DialogDescription>
              <strong>{sentConfirm?.name}</strong> can now log in with <strong>{sentConfirm?.email}</strong> and the password you set.
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
