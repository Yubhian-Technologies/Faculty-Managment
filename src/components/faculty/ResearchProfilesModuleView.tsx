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
import type { FacultyProfileFields, ResearchProfileRequest } from "@/types";

interface RequestFormState {
  orcidId: string;
  scopusAuthorId: string;
  researcherId: string;
  googleScholarId: string;
  irinsProfile: string;
}

// Field order matches how these are collected and displayed everywhere else
// in the Research Profiles tab: ORCID, Scopus, Researcher ID, Google
// Scholar, IRINS.
function formFromProfile(p: Partial<FacultyProfileFields>): RequestFormState {
  return {
    orcidId: p.orcidId ?? "",
    scopusAuthorId: p.scopusAuthorId ?? "",
    researcherId: p.researcherId ?? "",
    googleScholarId: p.googleScholarId ?? "",
    irinsProfile: p.irinsProfile ?? "",
  };
}

function formFromRequest(r: ResearchProfileRequest): RequestFormState {
  return {
    orcidId: r.orcidId ?? "",
    scopusAuthorId: r.scopusAuthorId ?? "",
    researcherId: r.researcherId ?? "",
    googleScholarId: r.googleScholarId ?? "",
    irinsProfile: r.irinsProfile ?? "",
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
      const res = await fetch("/api/college/research-profile", {
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
        <DialogTitle>Research Profiles</DialogTitle>
        <DialogDescription>This goes to R&amp;D for verification before it shows on your profile.</DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        <div className="space-y-2">
          <Label>ORCID iD</Label>
          <Input value={form.orcidId} onChange={(e) => set("orcidId", e.target.value)} placeholder="0000-0000-0000-0000" />
        </div>
        <div className="space-y-2">
          <Label>Scopus Author ID</Label>
          <Input value={form.scopusAuthorId} onChange={(e) => set("scopusAuthorId", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Researcher ID</Label>
          <Input value={form.researcherId} onChange={(e) => set("researcherId", e.target.value)} placeholder="Web of Science / Publons" />
        </div>
        <div className="space-y-2">
          <Label>Google Scholar ID</Label>
          <Input value={form.googleScholarId} onChange={(e) => set("googleScholarId", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>IRINS Profile</Label>
          <Input value={form.irinsProfile} onChange={(e) => set("irinsProfile", e.target.value)} placeholder="Profile URL" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} loading={saving}>Submit</Button>
      </DialogFooter>
    </>
  );
}

// The researcher IDs a person is identified by across indexing/reporting
// services - self-submitted, same PENDING/APPROVED/REJECTED verification
// flow as Research Publications (see /api/college/research-profile), just a
// single evolving record per person instead of a repeating list. Only the
// profile's own owner sees the submit/edit affordance and any pending or
// rejected state; every other viewer only ever sees the last APPROVED
// values, already reflected in academicProfile.
export function ResearchProfilesSection({
  academicProfile, isOwnProfile,
}: {
  academicProfile: Partial<FacultyProfileFields> | undefined;
  isOwnProfile?: boolean;
}) {
  const p = academicProfile ?? {};
  const [request, setRequest] = useState<ResearchProfileRequest | null>(null);
  // Non-owner viewers never fetch a request, so there's nothing to wait on -
  // lazy-initialize to already-loaded for them instead of setting it inside
  // the effect below (isOwnProfile is fixed for the life of this component).
  const [loaded, setLoaded] = useState(() => !isOwnProfile);
  const [formOpen, setFormOpen] = useState(false);

  function load() {
    fetch("/api/college/research-profile")
      .then((r) => r.json() as Promise<{ requests?: ResearchProfileRequest[] }>)
      .then((d) => setRequest(d.requests?.[0] ?? null))
      .catch(() => setRequest(null))
      .finally(() => setLoaded(true));
  }

  useEffect(() => { if (isOwnProfile) load(); }, [isOwnProfile]);

  const isPending = request?.status === "PENDING";
  const isRejected = request?.status === "REJECTED";
  const initialForm = request && (isPending || isRejected) ? formFromRequest(request) : formFromProfile(p);

  return (
    <Section number={3} title="Research Profiles">
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
        <Field label="ORCID iD" value={p.orcidId} />
        <Field label="Scopus Author ID" value={p.scopusAuthorId} />
        <Field label="Researcher ID" value={p.researcherId} />
        <Field label="Google Scholar ID" value={p.googleScholarId} />
        <Field label="IRINS Profile" value={p.irinsProfile} />
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
