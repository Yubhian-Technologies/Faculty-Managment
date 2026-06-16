"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Plus, FileText, Send, CheckCircle2, XCircle, Clock, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { OfferLetter, HiringBatch, Candidate, HiringSalaryAgreement } from "@/types";

type OfferRow = OfferLetter & { id: string };

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

const STATUS_CONFIG: Record<string, { label: string; color: "default" | "secondary" | "outline" | "destructive"; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "secondary", icon: Clock },
  GENERATED: { label: "Generated", color: "outline", icon: FileText },
  SENT: { label: "Sent", color: "outline", icon: Send },
  ACCEPTED: { label: "Accepted", color: "default", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "destructive", icon: XCircle },
};

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function AccountsOffersPage() {
  const [letters, setLetters] = useState<OfferRow[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [salaryMap, setSalaryMap] = useState<Record<string, HiringSalaryAgreement>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "SENT" | "ACCEPTED" | "REJECTED" | "DELETE" } | null>(null);
  const [isActing, setIsActing] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const [lettersRes, batchRes, salaryRes] = await Promise.all([
        fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferRow[] }>).then((d) => d.letters ?? []),
        fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => (d.batches ?? []).filter((b) => b.status === "COMPLETED")),
        fetch("/api/college/salary-records").then((r) => r.json() as Promise<{ records: HiringSalaryAgreement[] }>).then((d) => d.records ?? []),
      ]);

      setLetters(lettersRes);
      setBatches(batchRes);
      const map: Record<string, HiringSalaryAgreement> = {};
      for (const s of salaryRes) map[s.candidateId] = s;
      setSalaryMap(map);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function loadCandidatesForBatch(batchId: string) {
    setLoadingCandidates(true);
    try {
      const data = await fetch(`/api/college/candidates?batchId=${batchId}&stage=DECISION`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>);
      const cands = data.candidates ?? [];
      // filter out candidates already with letters
      const existingCandIds = new Set(letters.map((l) => l.candidateId));
      setCandidates(cands.filter((c) => !existingCandIds.has(c.id)));
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
      setDialogOpen(false);
      setForm(emptyForm());
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to create" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAction() {
    if (!actionTarget) return;
    setIsActing(true);
    try {
      if (actionTarget.action === "DELETE") {
        await fetch(`/api/college/offer-letters/${actionTarget.id}`, { method: "DELETE" });
        toast({ title: "Offer letter deleted" });
      } else {
        await fetch(`/api/college/offer-letters/${actionTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: actionTarget.action }),
        });
        toast({ variant: "success", title: `Status updated to ${actionTarget.action.toLowerCase()}` });
      }
      setActionTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setIsActing(false);
    }
  }

  const counts = {
    draft: letters.filter((l) => l.status === "DRAFT").length,
    sent: letters.filter((l) => l.status === "SENT").length,
    accepted: letters.filter((l) => l.status === "ACCEPTED").length,
    rejected: letters.filter((l) => l.status === "REJECTED").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offer Letters"
        description="Generate and manage offer letters for selected candidates"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Offer Letter
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Draft", value: counts.draft, className: "text-muted-foreground" },
          { label: "Sent", value: counts.sent, className: "text-blue-600" },
          { label: "Accepted", value: counts.accepted, className: "text-green-600" },
          { label: "Rejected", value: counts.rejected, className: "text-red-600" },
        ].map(({ label, value, className }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${className}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Letters list */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : letters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No offer letters yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create offer letters for candidates in the final decision stage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {letters.map((letter) => {
            const cfg = STATUS_CONFIG[letter.status] ?? STATUS_CONFIG.DRAFT;
            const Icon = cfg.icon;
            const isExpanded = expandedId === letter.id;
            const salary = salaryMap[letter.candidateId];

            return (
              <Card key={letter.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : letter.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{letter.candidateName}</p>
                      <p className="text-xs text-muted-foreground">
                        {letter.designation} · {letter.department}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.color}>
                        <Icon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Joining Date</p>
                        <p className="font-medium">{formatDate(letter.joiningDate as Parameters<typeof formatDate>[0])}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Annual CTC</p>
                        <p className="font-medium">{rupees(letter.ctcAnnual)}</p>
                      </div>
                      {salary && (
                        <div>
                          <p className="text-xs text-muted-foreground">Monthly CTC</p>
                          <p className="font-medium">{rupees(salary.agreedMonthly)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Generated By</p>
                        <p className="font-medium">{letter.generatedBy}</p>
                      </div>
                      {letter.subjects && letter.subjects.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground">Subjects</p>
                          <p className="font-medium">{letter.subjects.join(", ")}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      {letter.status === "DRAFT" && (
                        <Button size="sm" onClick={() => setActionTarget({ id: letter.id, action: "SENT" })}>
                          <Send className="h-3.5 w-3.5 mr-1" />
                          Mark as Sent
                        </Button>
                      )}
                      {letter.status === "SENT" && (
                        <>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setActionTarget({ id: letter.id, action: "ACCEPTED" })}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Mark Accepted
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setActionTarget({ id: letter.id, action: "REJECTED" })}>
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Mark Rejected
                          </Button>
                        </>
                      )}
                      {letter.status === "DRAFT" && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground ml-auto" onClick={() => setActionTarget({ id: letter.id, action: "DELETE" })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>New Offer Letter</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Finalized Batch *</Label>
              <Select value={form.batchId} onValueChange={handleBatchChange}>
                <SelectTrigger>
                  <SelectValue placeholder={batches.length === 0 ? "No finalized batches" : "Select batch..."} />
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

            <div className="grid grid-cols-2 gap-3">
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setForm(emptyForm()); }} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={isSaving}>
              Create Offer Letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action confirm */}
      <ConfirmDialog
        open={!!actionTarget}
        onOpenChange={(o) => { if (!o) setActionTarget(null); }}
        title={
          actionTarget?.action === "DELETE" ? "Delete Offer Letter?" :
          actionTarget?.action === "SENT" ? "Mark as Sent?" :
          actionTarget?.action === "ACCEPTED" ? "Mark as Accepted?" :
          "Mark as Rejected?"
        }
        description={
          actionTarget?.action === "DELETE" ? "This cannot be undone." :
          actionTarget?.action === "ACCEPTED" ? "This will mark the candidate as approved and finalize their hiring." :
          "Confirm this status change."
        }
        confirmLabel={
          actionTarget?.action === "DELETE" ? "Delete" :
          actionTarget?.action === "SENT" ? "Mark Sent" :
          actionTarget?.action === "ACCEPTED" ? "Mark Accepted" :
          "Mark Rejected"
        }
        variant={actionTarget?.action === "DELETE" || actionTarget?.action === "REJECTED" ? "destructive" : "default"}
        onConfirm={handleAction}
        loading={isActing}
      />
    </div>
  );
}
