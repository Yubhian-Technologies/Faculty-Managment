"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { HiringBatch, Candidate, HiringSalaryAgreement } from "@/types";

type CreateForm = {
  batchId: string;
  candidateId: string;
  designation: string;
  department: string;
  joiningDate: string;
  subjects: string;
};

const emptyForm = (): CreateForm => ({
  batchId: "", candidateId: "", designation: "", department: "", joiningDate: "", subjects: "",
});

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function NewAccountsOfferLetterPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [salaryMap, setSalaryMap] = useState<Record<string, HiringSalaryAgreement>>({});
  const [existingLetterCandidateIds, setExistingLetterCandidateIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());

  useEffect(() => {
    (async () => {
      try {
        const [lettersRes, batchRes, salaryRes] = await Promise.all([
          fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).then((d) => d.letters ?? []),
          fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => (d.batches ?? []).filter((b) => b.currentPhase === "COMPLETED" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW")),
          fetch("/api/college/salary-records").then((r) => r.json() as Promise<{ records: HiringSalaryAgreement[] }>).then((d) => d.records ?? []),
        ]);

        setExistingLetterCandidateIds(new Set(lettersRes.map((l) => l.candidateId)));
        setBatches(batchRes);
        const map: Record<string, HiringSalaryAgreement> = {};
        for (const s of salaryRes) map[s.candidateId] = s;
        setSalaryMap(map);
      } catch {
        toast({ variant: "destructive", title: "Failed to load" });
      }
    })();
  }, []);

  async function loadCandidatesForBatch(batchId: string) {
    setLoadingCandidates(true);
    try {
      const data = await fetch(`/api/college/candidates?batchId=${batchId}&stage=DECISION`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>);
      const cands = data.candidates ?? [];
      // filter out candidates already with letters
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

  async function handleCreate() {
    if (!form.batchId || !form.candidateId || !form.designation || !form.department || !form.joiningDate) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    const salary = salaryMap[form.candidateId];
    if (!salary) {
      toast({ variant: "destructive", title: "No salary agreement found for this candidate", description: "Create one in Salary Records first." });
      return;
    }
    setIsSaving(true);
    try {
      const selectedCandidate = candidates.find((c) => c.id === form.candidateId);
      const res = await fetch("/api/college/offer-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: form.candidateId,
          batchId: form.batchId,
          candidateName: selectedCandidate?.name ?? "",
          designation: form.designation,
          department: form.department,
          joiningDate: form.joiningDate,
          ctcAnnual: salary.agreedAnnual,
          subjects: form.subjects.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Offer letter created" });
      router.push("/accounts/offers");
    } catch {
      toast({ variant: "destructive", title: "Failed to create" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="New Offer Letter"
        description="Generate an offer letter for a candidate with a finalized salary agreement"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Finalized Batch *</Label>
              <Select value={form.batchId} onValueChange={handleBatchChange}>
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
                <Select value={form.candidateId} onValueChange={(v) => setForm((f) => ({ ...f, candidateId: v }))} disabled={loadingCandidates}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCandidates ? "Loading..." : candidates.length === 0 ? "No eligible candidates" : "Select candidate..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.email}
                        {!salaryMap[c.id] && " ⚠ No salary agreement"}
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

            <div className="space-y-2">
              <Label>Joining Date *</Label>
              <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Subjects (comma-separated)</Label>
              <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Data Structures, Algorithms" />
            </div>

            {form.candidateId && salaryMap[form.candidateId] && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">CTC from salary agreement</p>
                  <p className="font-bold">{rupees(salaryMap[form.candidateId].agreedAnnual)} / year</p>
                  <p className="text-muted-foreground">{rupees(salaryMap[form.candidateId].agreedMonthly)} / month</p>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleCreate} loading={isSaving}>Create Offer Letter</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
