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
import { stripLeadingZeros } from "@/lib/utils";

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  department: string;
  status: string;
}

export default function NewHROfferPage() {
  const router = useRouter();
  const [selectedCandidates, setSelectedCandidates] = useState<LocationCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    candidateId: "", candidateName: "", candidateEmail: "", department: "",
    joiningDate: "", salary: "", remarks: "",
  });

  useEffect(() => {
    // Load candidates eligible for offer letters: SELECTED or SHORTLISTED (post-interview)
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => setSelectedCandidates(
        (d.candidates ?? []).filter((c) => c.status === "SELECTED" || c.status === "SHORTLISTED")
      ))
      .catch(() => {});
  }, []);

  function onCandidateSelect(candidateId: string) {
    const candidate = selectedCandidates.find((c) => c.id === candidateId);
    if (candidate) {
      setForm((f) => ({
        ...f,
        candidateId,
        candidateName: candidate.name,
        candidateEmail: candidate.email ?? "",
        department: candidate.department,
      }));
    }
  }

  const isValid = !!form.candidateId && !!form.joiningDate && !!form.salary;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/location/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: form.candidateId,
          candidateName: form.candidateName,
          candidateEmail: form.candidateEmail,
          department: form.department,
          joiningDate: form.joiningDate,
          salary: Number(form.salary),
          remarks: form.remarks,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Offer letter submitted", description: "Administration will review and approve." });
      router.push("/hr-admin/offers");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Create Offer Letter"
        description="Prepare an offer letter for a selected candidate — Administration approval required"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offer Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Candidate <span className="text-destructive">*</span></Label>
              <Select value={form.candidateId} onValueChange={onCandidateSelect}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedCandidates.length === 0 ? "No eligible candidates" : "Select selected candidate..."} />
                </SelectTrigger>
                <SelectContent>
                  {selectedCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.department}
                      {c.status === "SELECTED" ? " ✓" : " (shortlisted)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCandidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No candidates available yet. Complete an interview and use Finalize Decisions to mark candidates first.
                </p>
              )}
            </div>

            {form.candidateName && (
              <div className="rounded bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Email:</span> {form.candidateEmail}</p>
                <p><span className="text-muted-foreground">Department:</span> {form.department}</p>
                <p><span className="text-muted-foreground">Position:</span> Faculty</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Joining Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Monthly Salary (₹) <span className="text-destructive">*</span></Label>
                <Input type="number" value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: stripLeadingZeros(e.target.value) }))} placeholder="45000" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} placeholder="Probation period, conditions, etc." />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Submit for Approval</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
