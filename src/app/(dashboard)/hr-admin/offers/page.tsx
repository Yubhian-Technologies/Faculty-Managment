"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationOffer {
  id: string;
  candidateName: string;
  candidateEmail: string;
  department: string;
  position: string;
  joiningDate: unknown;
  salary: number;
  status: string;
  createdAt: unknown;
  remarks?: string;
}

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  department: string;
  status: string;
}

export default function HROffersPage() {
  const isMobile = useMobile();
  const [offers, setOffers] = useState<LocationOffer[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    candidateId: "", candidateName: "", candidateEmail: "", department: "",
    joiningDate: "", salary: "", remarks: "",
  });

  function load() {
    setIsLoading(true);
    fetch("/api/location/offers")
      .then((r) => r.json() as Promise<{ offers: LocationOffer[] }>)
      .then((d) => setOffers(d.offers ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load offers" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // Load candidates eligible for offer letters: SELECTED or SHORTLISTED (post-interview)
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => setSelectedCandidates(
        (d.candidates ?? []).filter((c) => c.status === "SELECTED" || c.status === "SHORTLISTED")
      ))
      .catch(() => {});
  }, []);

  function openCreate() {
    setForm({ candidateId: "", candidateName: "", candidateEmail: "", department: "", joiningDate: "", salary: "", remarks: "" });
    setCreateOpen(true);
  }

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.candidateId || !form.joiningDate || !form.salary) return;
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
      setCreateOpen(false);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offer Letters"
        description="Prepare offer letters for selected candidates — Administration approval required"
        actions={
          <Button onClick={openCreate} disabled={selectedCandidates.length === 0}>
            + Create Offer Letter
          </Button>
        }
      />

      {selectedCandidates.length === 0 && offers.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No candidates available yet. Complete an interview and use <strong>Finalize Decisions</strong> to mark candidates, then create an offer letter here.
        </div>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {offers.map((o) => (
            <MobileCard
              key={o.id}
              title={o.candidateName}
              subtitle={`${o.department} · ${o.position}`}
              badge={<StatusBadge status={o.status} />}
              fields={[
                { label: "Email", value: o.candidateEmail },
                { label: "Joining Date", value: formatDate(o.joiningDate as Parameters<typeof formatDate>[0]) },
                { label: "Salary", value: `₹${o.salary.toLocaleString()}/month` },
              ]}
            />
          ))}
          {!isLoading && offers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No offer letters created yet.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={offers as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by name, department..."
          searchKeys={["candidateName", "department"]}
          csvFilename="hr-offers"
          columns={[
            { key: "candidateName", header: "Candidate" },
            { key: "department", header: "Department" },
            { key: "position", header: "Position" },
            { key: "joiningDate", header: "Joining Date", render: (r) => formatDate((r as unknown as LocationOffer).joiningDate as Parameters<typeof formatDate>[0]) },
            { key: "salary", header: "Salary (₹/mo)", render: (r) => `₹${(r as unknown as LocationOffer).salary.toLocaleString()}` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationOffer).status} /> },
            { key: "createdAt", header: "Created", render: (r) => formatDate((r as unknown as LocationOffer).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Create Offer Letter</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Candidate <span className="text-destructive">*</span></Label>
              <Select value={form.candidateId} onValueChange={onCandidateSelect}>
                <SelectTrigger><SelectValue placeholder="Select selected candidate..." /></SelectTrigger>
                <SelectContent>
                  {selectedCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.department}
                      {c.status === "SELECTED" ? " ✓" : " (shortlisted)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.candidateName && (
              <div className="rounded bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Email:</span> {form.candidateEmail}</p>
                <p><span className="text-muted-foreground">Department:</span> {form.department}</p>
                <p><span className="text-muted-foreground">Position:</span> Faculty</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!form.candidateId || !form.joiningDate || !form.salary}>
                Submit for Approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
