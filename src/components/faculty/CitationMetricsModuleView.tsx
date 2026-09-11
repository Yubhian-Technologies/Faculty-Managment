"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Section, Field } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields, CitationMetricsRequest } from "@/types";

interface RequestFormState {
  totalCitations: string;
  hIndex: string;
  citationsExcludingSelf: string;
  hIndexExcludingSelf: string;
}

function formFromProfile(p: Partial<FacultyProfileFields>): RequestFormState {
  return {
    totalCitations: p.citationsTotal !== undefined ? String(p.citationsTotal) : "",
    hIndex: p.citationsHIndex !== undefined ? String(p.citationsHIndex) : "",
    citationsExcludingSelf: p.citationsExcludingSelf !== undefined ? String(p.citationsExcludingSelf) : "",
    hIndexExcludingSelf: p.citationsHIndexExcludingSelf !== undefined ? String(p.citationsHIndexExcludingSelf) : "",
  };
}

function formFromRequest(r: CitationMetricsRequest): RequestFormState {
  return {
    totalCitations: r.totalCitations !== undefined ? String(r.totalCitations) : "",
    hIndex: r.hIndex !== undefined ? String(r.hIndex) : "",
    citationsExcludingSelf: r.citationsExcludingSelf !== undefined ? String(r.citationsExcludingSelf) : "",
    hIndexExcludingSelf: r.hIndexExcludingSelf !== undefined ? String(r.hIndexExcludingSelf) : "",
  };
}

function RequestFormFields({
  initial, onCancel, onSaved,
}: {
  initial: RequestFormState;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RequestFormState>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/citation-metrics", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to submit", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Submitted for verification" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Citations &amp; H-Index Growth</DialogTitle>
        <DialogDescription>This goes to R&amp;D for verification before it shows on your profile.</DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Total No. of Citations</Label>
            <Input type="number" value={form.totalCitations} onChange={(e) => set("totalCitations", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>H-Index</Label>
            <Input type="number" value={form.hIndex} onChange={(e) => set("hIndex", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>No. of Citations Excluding Self Citations</Label>
            <Input type="number" value={form.citationsExcludingSelf} onChange={(e) => set("citationsExcludingSelf", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>H-Index (Excluding Self Citations)</Label>
            <Input type="number" value={form.hIndexExcludingSelf} onChange={(e) => set("hIndexExcludingSelf", e.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} loading={saving}>Submit</Button>
      </DialogFooter>
    </>
  );
}

// Citation/H-Index metrics - self-submitted, same PENDING/APPROVED/REJECTED
// verification flow as Research Profiles (see /api/college/citation-metrics),
// a single evolving record per person. Only the profile's own owner sees the
// submit/edit affordance and any pending/rejected state; every other viewer
// only ever sees the last APPROVED values, already reflected in
// academicProfile.
export function CitationMetricsSection({
  academicProfile, isOwnProfile,
}: {
  academicProfile: Partial<FacultyProfileFields> | undefined;
  isOwnProfile?: boolean;
}) {
  const p = academicProfile ?? {};
  const [request, setRequest] = useState<CitationMetricsRequest | null>(null);
  const [loaded, setLoaded] = useState(() => !isOwnProfile);
  const [formOpen, setFormOpen] = useState(false);

  function load() {
    fetch("/api/college/citation-metrics")
      .then((r) => r.json() as Promise<{ requests?: CitationMetricsRequest[] }>)
      .then((d) => setRequest(d.requests?.[0] ?? null))
      .catch(() => setRequest(null))
      .finally(() => setLoaded(true));
  }

  useEffect(() => { if (isOwnProfile) load(); }, [isOwnProfile]);

  const isPending = request?.status === "PENDING";
  const isRejected = request?.status === "REJECTED";
  const initialForm = request && (isPending || isRejected) ? formFromRequest(request) : formFromProfile(p);

  return (
    <Section number={3} title="Citations & H-Index Growth">
      {isOwnProfile && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isPending && <Badge variant="pending" className="text-xs">Pending Verification</Badge>}
            {isRejected && <Badge variant="rejected" className="text-xs">Rejected</Badge>}
          </div>
          {loaded && !isPending && (
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" />{isRejected ? "Edit & Resubmit" : "Add / Edit"}
            </Button>
          )}
        </div>
      )}
      {isRejected && request?.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {request.rejectionReason}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Total No. of Citations" value={p.citationsTotal} />
        <Field label="H-Index" value={p.citationsHIndex} />
        <Field label="Citations Excluding Self Citations" value={p.citationsExcludingSelf} />
        <Field label="H-Index (Excl. Self Citations)" value={p.citationsHIndexExcludingSelf} />
      </div>

      {isOwnProfile && (
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="w-[95vw] max-w-[1400px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
            {formOpen && (
              <RequestFormFields
                initial={initialForm}
                onCancel={() => setFormOpen(false)}
                onSaved={() => { setFormOpen(false); load(); }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </Section>
  );
}
