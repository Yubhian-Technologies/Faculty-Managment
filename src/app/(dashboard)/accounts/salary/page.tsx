"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Plus, IndianRupee } from "lucide-react";
import type { HiringSalaryAgreement, HiringBatch, Candidate } from "@/types";

type RecordRow = Record<string, unknown> & HiringSalaryAgreement;

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

function n(v: string) { return parseFloat(v) || 0; }

export default function AccountsSalaryPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SalaryForm>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  function loadRecords() {
    return fetch("/api/college/salary-records")
      .then((r) => r.json() as Promise<{ records: RecordRow[] }>)
      .then((d) => setRecords(d.records ?? []));
  }

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      loadRecords(),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => setBatches((d.batches ?? []).filter((b) => b.currentPhase === "COMPLETED" || b.currentPhase === "PRINCIPAL_FINAL_REVIEW"))),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function loadCandidatesForBatch(batchId: string) {
    setLoadingCandidates(true);
    try {
      const data = await fetch(`/api/college/candidates?batchId=${batchId}&stage=DECISION`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>);
      // exclude candidates who already have a salary agreement
      const existingIds = new Set(records.map((r) => r.candidateId as string));
      setCandidates((data.candidates ?? []).filter((c) => !existingIds.has(c.id)));
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function handleBatchChange(batchId: string) {
    setForm((f) => ({ ...f, batchId, candidateId: "" }));
    void loadCandidatesForBatch(batchId);
  }

  // Computed
  const gross = n(form.basic) + n(form.hra) + n(form.da) + n(form.ta) + n(form.medicalAllowance) + n(form.otherAllowances);
  const deductions = n(form.pf) + n(form.professionalTax) + n(form.tds);
  const monthly = gross - deductions;
  const annual = monthly * 12;

  async function handleSubmit() {
    if (!form.batchId || !form.candidateId) {
      toast({ variant: "destructive", title: "Select a batch and candidate" });
      return;
    }
    if (!n(form.basic)) {
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
            basic: n(form.basic), hra: n(form.hra), da: n(form.da), ta: n(form.ta),
            medicalAllowance: n(form.medicalAllowance), otherAllowances: n(form.otherAllowances),
            pf: n(form.pf), professionalTax: n(form.professionalTax), tds: n(form.tds),
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Salary agreement saved", description: "Candidate moved to offer letter stage." });
      setDialogOpen(false);
      setForm(emptyForm());
      await loadRecords();
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  const totalMonthly = records.reduce((s, r) => s + ((r.agreedMonthly as number) ?? 0), 0);
  const totalAnnual = records.reduce((s, r) => s + ((r.agreedAnnual as number) ?? 0), 0);

  const columns: Column<RecordRow>[] = [
    {
      key: "candidateName",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{(row.candidateName as string) || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.candidateId as string}</p>
        </div>
      ),
    },
    { key: "agreedMonthly", header: "Monthly CTC", render: (row) => <span className="font-medium">{rupees(row.agreedMonthly as number)}</span> },
    { key: "agreedAnnual", header: "Annual CTC", render: (row) => rupees(row.agreedAnnual as number) },
    {
      key: "breakdown",
      header: "Basic",
      hideOnMobile: true,
      render: (row) => {
        const b = row.breakdown as HiringSalaryAgreement["breakdown"];
        return b?.basic ? rupees(b.basic) : "—";
      },
    },
    { key: "negotiatedBy", header: "By", hideOnMobile: true, render: (row) => (row.negotiatedBy as string) || "—" },
    { key: "agreedAt", header: "Date", render: (row) => formatDate(row.agreedAt as Parameters<typeof formatDate>[0]) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Records"
        description="Hiring salary agreements negotiated during recruitment"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Agreement
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Agreements</p>
            <p className="text-2xl font-bold">{records.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Monthly Payout</p>
            <p className="text-2xl font-bold">{isLoading ? "—" : rupees(totalMonthly)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Annual Commitment</p>
            <p className="text-2xl font-bold">{isLoading ? "—" : rupees(totalAnnual)}</p>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={records}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search by candidate or negotiator..."
        searchKeys={["candidateName", "negotiatedBy"] as (keyof RecordRow)[]}
        emptyTitle="No salary records yet"
        emptyDescription="Add salary agreements for candidates after interviews are complete"
        csvFilename="salary-records"
      />

      {/* Create Agreement Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>New Salary Agreement</DialogTitle>
          </DialogHeader>

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
                <Select value={form.candidateId} onValueChange={(v) => setForm((f) => ({ ...f, candidateId: v }))} disabled={loadingCandidates}>
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
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
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
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Summary */}
            {n(form.basic) > 0 && (
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setForm(emptyForm()); }} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={isSaving}>
              Save Agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
