"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import { IndianRupee, Sparkles } from "lucide-react";
import type { HiringBatch, Candidate, HRFeedback, HiringSalaryAgreement } from "@/types";

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type SalaryForm = {
  batchId: string;
  candidateId: string;
  basic: string;
  hra: string;
  da: string;
  ta: string;
  medicalAllowance: string;
  otherAllowances: string;
  pf: string;
  professionalTax: string;
  tds: string;
};

const emptyForm = (): SalaryForm => ({
  batchId: "", candidateId: "",
  basic: "", hra: "", da: "", ta: "",
  medicalAllowance: "", otherAllowances: "",
  pf: "", professionalTax: "", tds: "",
});

function num(v: string) { return parseFloat(v) || 0; }

// Distribute a gross monthly salary into standard components
function autoFillFromGross(gross: number): Partial<SalaryForm> {
  const basic = Math.round(gross * 0.40);
  const hra = Math.round(basic * 0.40);
  const da = Math.round(basic * 0.10);
  const ta = Math.round(basic * 0.10);
  const medical = Math.round(gross * 0.02);
  const other = gross - basic - hra - da - ta - medical;
  const pf = Math.round(basic * 0.12);
  return {
    basic: String(basic),
    hra: String(hra),
    da: String(da),
    ta: String(ta),
    medicalAllowance: String(medical),
    otherAllowances: String(Math.max(0, other)),
    pf: String(pf),
    professionalTax: "200",
    tds: "0",
  };
}

export default function NewSalaryAgreementPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [existingCandidateIds, setExistingCandidateIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [hrFeedback, setHrFeedback] = useState<HRFeedback | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [form, setForm] = useState<SalaryForm>(emptyForm());

  useEffect(() => {
    Promise.all([
      fetch("/api/college/salary-records")
        .then((r) => r.json() as Promise<{ records: HiringSalaryAgreement[] }>)
        .then((d) => setExistingCandidateIds(new Set((d.records ?? []).map((r) => r.candidateId)))),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => setBatches((d.batches ?? []).filter((b) => b.currentPhase === "COMPLETED" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW"))),
    ]).catch(() => toast({ variant: "destructive", title: "Failed to load" }));
  }, []);

  async function loadCandidatesForBatch(batchId: string) {
    setLoadingCandidates(true);
    setHrFeedback(null);
    try {
      const data = await fetch(`/api/college/candidates?batchId=${batchId}&stage=DECISION`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>);
      setCandidates((data.candidates ?? []).filter((c) => !existingCandidateIds.has(c.id)));
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function handleCandidateChange(candidateId: string) {
    setForm((f) => ({ ...f, candidateId }));
    setHrFeedback(null);
    if (!form.batchId || !candidateId) return;

    setLoadingFeedback(true);
    try {
      const data = await fetch(
        `/api/college/hr-feedback?batchId=${form.batchId}&candidateId=${candidateId}`
      ).then((r) => r.json() as Promise<{ feedback: HRFeedback[] }>);
      const fb = data.feedback?.[0] ?? null;
      setHrFeedback(fb);

      // Auto-fill salary breakdown from candidate's stated salary expectation
      if (fb?.salaryExpectation && fb.salaryExpectation > 0) {
        setForm((f) => ({ ...f, candidateId, ...autoFillFromGross(fb.salaryExpectation!) }));
      }
    } catch {
      // no feedback — that's fine
    } finally {
      setLoadingFeedback(false);
    }
  }

  function handleBatchChange(batchId: string) {
    setForm((f) => ({ ...f, batchId, candidateId: "" }));
    setHrFeedback(null);
    void loadCandidatesForBatch(batchId);
  }

  function applyAutoFill() {
    if (!hrFeedback?.salaryExpectation) return;
    setForm((f) => ({ ...f, ...autoFillFromGross(hrFeedback!.salaryExpectation!) }));
  }

  // Computed
  const gross = num(form.basic) + num(form.hra) + num(form.da) + num(form.ta) + num(form.medicalAllowance) + num(form.otherAllowances);
  const deductions = num(form.pf) + num(form.professionalTax) + num(form.tds);
  const monthly = gross - deductions;
  const annual = monthly * 12;

  async function handleSubmit() {
    if (!form.batchId || !form.candidateId) {
      toast({ variant: "destructive", title: "Select a batch and candidate" });
      return;
    }
    if (!num(form.basic)) {
      toast({ variant: "destructive", title: "Basic salary is required" });
      return;
    }
    setIsSaving(true);
    try {
      const selectedCandidate = candidates.find((c) => c.id === form.candidateId);
      const res = await fetch("/api/college/salary-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: form.candidateId,
          batchId: form.batchId,
          candidateName: selectedCandidate?.name ?? "",
          agreedMonthly: monthly,
          agreedAnnual: annual,
          breakdown: {
            basic: num(form.basic), hra: num(form.hra), da: num(form.da), ta: num(form.ta),
            medicalAllowance: num(form.medicalAllowance), otherAllowances: num(form.otherAllowances),
            pf: num(form.pf), professionalTax: num(form.professionalTax), tds: num(form.tds),
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Salary agreement saved", description: "Candidate moved to offer letter stage." });
      router.push("/accounts/salary");
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Salary Agreement"
        description="Negotiate and record a hiring salary agreement for a selected candidate"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agreement Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Batch + Candidate */}
            <div className="space-y-2">
              <Label>Interview Batch *</Label>
              <Select value={form.batchId} onValueChange={handleBatchChange}>
                <SelectTrigger>
                  <SelectValue placeholder={batches.length === 0 ? "No completed batches" : "Select a batch..."} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.position} — {b.department} ({formatDate(b.interviewDate)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.batchId && (
              <div className="space-y-2">
                <Label>Candidate *</Label>
                <Select value={form.candidateId} onValueChange={(v) => void handleCandidateChange(v)} disabled={loadingCandidates}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCandidates ? "Loading..." : "Select candidate..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} — {c.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Negotiated salary from HR interview */}
            {form.candidateId && (
              loadingFeedback ? (
                <div className="text-xs text-muted-foreground animate-pulse">Fetching interview salary data…</div>
              ) : hrFeedback?.salaryExpectation ? (
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-amber-800">Negotiated salary at interview</p>
                        <p className="text-lg font-bold text-amber-900">{rupees(hrFeedback.salaryExpectation)} / month</p>
                        {hrFeedback.noticePeriod && (
                          <p className="text-xs text-amber-700 mt-0.5">Notice period: {hrFeedback.noticePeriod}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <Badge variant="outline" className="text-amber-700 border-amber-300 text-xs">HR Interview</Badge>
                        <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-800 hover:bg-amber-100" onClick={applyAutoFill}>
                          <Sparkles className="h-3 w-3 mr-1" />
                          Auto-fill
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground">No salary expectation recorded in HR interview for this candidate.</p>
              )
            )}

            {/* Salary Breakdown */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Earnings (₹/month)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["basic", "Basic *"],
                  ["hra", "HRA"],
                  ["da", "DA"],
                  ["ta", "TA"],
                  ["medicalAllowance", "Medical"],
                  ["otherAllowances", "Other"],
                ] as [keyof SalaryForm, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: stripLeadingZeros(e.target.value) }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Deductions (₹/month)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {([
                  ["pf", "PF"],
                  ["professionalTax", "Professional Tax"],
                  ["tds", "TDS"],
                ] as [keyof SalaryForm, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: stripLeadingZeros(e.target.value) }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Summary */}
            {num(form.basic) > 0 && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross Monthly</span>
                    <span>{rupees(gross)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Deductions</span>
                    <span className="text-red-600">−{rupees(deductions)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1 mt-1">
                    <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3" />Net Monthly CTC</span>
                    <span>{rupees(monthly)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Annual CTC</span>
                    <span>{rupees(annual)}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSubmit} loading={isSaving}>Save Agreement</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
