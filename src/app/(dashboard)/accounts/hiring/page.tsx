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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { FileText, Wand2, CheckCircle2 } from "lucide-react";
import type { Candidate, HiringBatch } from "@/types";

type CreateForm = {
  candidateId: string;
  batchId: string;
  designation: string;
  department: string;
  joiningDate: string;
  ctcAnnual: string;
  subjects: string;
  collegeEmail: string;
  facultyPassword: string;
};

function randomPassword(): string {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

const emptyForm = (): CreateForm => ({
  candidateId: "", batchId: "", designation: "", department: "",
  joiningDate: "", ctcAnnual: "", subjects: "", collegeEmail: "", facultyPassword: "",
});

export default function AccountsHiringPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [existingLetterIds, setExistingLetterIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [sentConfirm, setSentConfirm] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>),
    ])
      .then(([cRes, bRes, lRes]) => {
        const pending = (cRes.candidates ?? []).filter(
          (c) => (c as unknown as { currentStage?: string }).currentStage === "DECISION"
        );
        setCandidates(pending);
        setBatches(bRes.batches ?? []);
        setExistingLetterIds(new Set((lRes.letters ?? []).map((l) => l.candidateId)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  function openForm(c: Candidate) {
    const batch = batches.find((b) => b.id === (c as unknown as { batchId?: string }).batchId);
    setSelected(c);
    setForm({
      ...emptyForm(),
      candidateId: c.id,
      batchId: batch?.id ?? "",
      designation: batch?.position ?? "",
      department: c.department ?? batch?.department ?? "",
    });
  }

  async function handleSend() {
    const { candidateId, batchId, designation, department, joiningDate, ctcAnnual, collegeEmail, facultyPassword } = form;
    if (!candidateId || !designation || !department || !joiningDate || !ctcAnnual || !collegeEmail || !facultyPassword) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/offer-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          batchId,
          candidateName: selected?.name ?? "",
          designation,
          department,
          joiningDate,
          ctcAnnual: Number(ctcAnnual),
          subjects: form.subjects.split(",").map((s) => s.trim()).filter(Boolean),
          collegeEmail,
          facultyPassword,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to send offer");
      setSentConfirm({ name: selected?.name ?? "the candidate", email: collegeEmail });
      setExistingLetterIds((prev) => new Set([...prev, candidateId]));
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to send offer", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  const pendingOffer = candidates.filter((c) => !existingLetterIds.has(c.id));
  const offered = candidates.filter((c) => existingLetterIds.has(c.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring - Offer Letters"
        description="Send offer letters to Principal-approved candidates and create their faculty accounts"
      />

      {isLoading ? (
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      ) : pendingOffer.length === 0 && offered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No candidates pending offer letters</p>
            <p className="text-sm mt-1">Candidates appear here after the Principal approves their hiring decision.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendingOffer.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending Offer Letters ({pendingOffer.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingOffer.map((c) => {
                  const batch = batches.find((b) => b.id === (c as unknown as { batchId?: string }).batchId);
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.email} · {batch?.position ?? c.department}</p>
                      </div>
                      <Button size="sm" onClick={() => openForm(c)}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Send Offer
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {offered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">Offers Already Sent ({offered.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {offered.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Offer Sent
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Offer Letter Form Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setForm(emptyForm()); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Offer Letter - {selected?.name}</DialogTitle>
            <DialogDescription>Fill in employment details. A faculty login account will be created automatically.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Designation *</Label>
                <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Assistant Professor" />
              </div>
              <div className="space-y-1.5">
                <Label>Department *</Label>
                <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Computer Science" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Joining Date *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Annual CTC (₹) *</Label>
                <Input type="number" min="0" value={form.ctcAnnual} onChange={(e) => setForm((f) => ({ ...f, ctcAnnual: e.target.value }))} placeholder="e.g. 600000" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Subjects (comma-separated)</Label>
              <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Data Structures, Algorithms" />
            </div>

            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Faculty Login Account</p>
              <div className="space-y-1.5">
                <Label>College Email *</Label>
                <Input type="email" value={form.collegeEmail} onChange={(e) => setForm((f) => ({ ...f, collegeEmail: e.target.value }))} placeholder="name@vishnu.edu.in" />
                <p className="text-xs text-muted-foreground">This becomes their login - not the candidate's personal email.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Password *</Label>
                <div className="flex gap-2">
                  <Input value={form.facultyPassword} onChange={(e) => setForm((f) => ({ ...f, facultyPassword: e.target.value }))} placeholder="Set a login password" />
                  <Button type="button" variant="outline" size="icon" onClick={() => setForm((f) => ({ ...f, facultyPassword: randomPassword() }))}>
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelected(null); setForm(emptyForm()); }} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSend} loading={isSaving}>Send Offer Letter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={!!sentConfirm} onOpenChange={(o) => { if (!o) setSentConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Offer Sent & Faculty Account Created</DialogTitle>
            <DialogDescription>
              <strong>{sentConfirm?.name}</strong> can now log in with <strong>{sentConfirm?.email}</strong> and the password you set.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setSentConfirm(null); router.push("/accounts"); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
