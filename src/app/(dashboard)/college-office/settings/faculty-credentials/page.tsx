"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { KeyRound, UserCog, Eye, CheckCircle2, XCircle, Loader2, Search } from "lucide-react";
import { FACULTY_ACCOUNT_REQUEST_STATUS_LABELS } from "@/types";
import type {
  Candidate,
  CandidateApplication,
  OfferLetter,
  FacultyAccountRequest,
  FacultyAccountRequestStatus,
} from "@/types";

// Office joins person fields onto each Principal-approved, non-rejected
// application, exactly like college-office/documents/page.tsx — `id` is the
// applicationId, `candidateId` is the real Candidate id (offer letters key on it).
type EligibleCandidate = {
  applicationId: string;
  candidateId: string;
  offerId: string;
  name: string;
  email: string;
  department: string;
  position: string;
};

type CandidateForm = {
  officialEmail: string;
};

type EmailField = keyof CandidateForm;
type Availability = "unchecked" | "checking" | "available" | "taken";

function emptyForm(email: string): CandidateForm {
  return { officialEmail: email };
}

function availabilityKey(applicationId: string, field: EmailField): string {
  return `${applicationId}:${field}`;
}

// "Past" = the request is fully wrapped up and needs no more office action:
// COMPLETED with nothing left to reveal (creds already revealed, or none to
// reveal). Everything else — including a COMPLETED request whose credentials
// the office still has to reveal — counts as active.
function isPastRequest(r: FacultyAccountRequest): boolean {
  const revealPending = !!r.credentialResult && !r.credentialResult.revealed;
  return r.status === "COMPLETED" && !revealPending;
}

export default function FacultyCredentialsPage() {
  const searchParams = useSearchParams();
  const [eligible, setEligible] = useState<EligibleCandidate[]>([]);
  const [requests, setRequests] = useState<(FacultyAccountRequest & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forms, setForms] = useState<Record<string, CandidateForm>>({});
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealBusyId, setRevealBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; email: string; password: string } | null>(null);
  const [requestScope, setRequestScope] = useState<"active" | "past">("active");

  function load() {
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string; batchId: string }[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: (FacultyAccountRequest & { id: string })[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([appsRes, candsRes, offersRes, appointmentsRes, requestsRes]) => {
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const decisionApps = (appsRes.applications ?? []).filter((a) => a.status !== "REJECTED");
        const appointedKeys = new Set((appointmentsRes.letters ?? []).map((l) => `${l.candidateId}::${l.batchId}`));
        const requestedOfferIds = new Set((requestsRes.requests ?? []).map((r) => r.offerId));

        // Prefer a non-rejected offer per (candidate, batch) — same rule as documents/page.tsx.
        const offerByKey = new Map<string, OfferLetter>();
        for (const letter of offersRes.letters ?? []) {
          if (letter.status === "REJECTED") continue;
          const key = `${letter.candidateId}::${letter.batchId}`;
          if (!offerByKey.has(key)) offerByKey.set(key, letter);
        }

        const list: EligibleCandidate[] = [];
        for (const a of decisionApps) {
          const key = `${a.candidateId}::${a.batchId ?? ""}`;
          const offer = offerByKey.get(key);
          if (!offer || offer.status !== "ACCEPTED") continue;
          if (!offer.candidateConfirmedJoiningDate) continue;
          if (!appointedKeys.has(key)) continue;
          if (requestedOfferIds.has(offer.id)) continue;
          const person = personMap.get(a.candidateId);
          list.push({
            applicationId: a.id,
            candidateId: a.candidateId,
            offerId: offer.id,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            department: a.department,
            position: a.position,
          });
        }
        setEligible(list);
        setForms((prev) => {
          const next = { ...prev };
          for (const c of list) if (!next[c.applicationId]) next[c.applicationId] = emptyForm(c.email);
          return next;
        });

        const order: Record<FacultyAccountRequestStatus, number> = { SUBMITTED: 0, IN_PROGRESS: 1, CREDENTIALS_CREATED: 2, COMPLETED: 3 };
        const sortedRequests = [...(requestsRes.requests ?? [])].sort((a, b) => order[a.status] - order[b.status]);
        setRequests(sortedRequests);

        const preselectIds = new Set((searchParams.get("ids") ?? "").split(",").filter(Boolean));
        if (preselectIds.size > 0) {
          setSelected(new Set(list.filter((c) => preselectIds.has(c.applicationId)).map((c) => c.applicationId)));
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSelected(applicationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }

  function updateForm(applicationId: string, field: EmailField, value: string) {
    setForms((prev) => ({ ...prev, [applicationId]: { ...prev[applicationId], [field]: value } }));
    // Any edit invalidates the last check on that field - re-check before relying on it again.
    setAvailability((prev) => ({ ...prev, [availabilityKey(applicationId, field)]: "unchecked" }));
  }

  // Checked on blur (like the Webmaster's own email-assignment form) rather
  // than on every keystroke - avoids a query per character while still
  // catching a collision before the request is sent, not after.
  async function checkAvailability(applicationId: string, field: EmailField, email: string) {
    const key = availabilityKey(applicationId, field);
    if (!email.trim()) {
      setAvailability((prev) => ({ ...prev, [key]: "unchecked" }));
      return;
    }
    setAvailability((prev) => ({ ...prev, [key]: "checking" }));
    try {
      const res = await fetch(`/api/college/email-requests/check-availability?email=${encodeURIComponent(email.trim())}`);
      const data = (await res.json()) as { available?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setAvailability((prev) => ({ ...prev, [key]: data.available ? "available" : "taken" }));
    } catch {
      setAvailability((prev) => ({ ...prev, [key]: "unchecked" }));
    }
  }

  async function handleSubmit() {
    const targets = eligible.filter((c) => selected.has(c.applicationId));
    if (targets.length === 0) return;

    for (const c of targets) {
      const form = forms[c.applicationId];
      if (!form?.officialEmail.trim()) {
        toast({ variant: "destructive", title: `${c.name}: recommended email is required` });
        return;
      }
      const status = availability[availabilityKey(c.applicationId, "officialEmail")];
      if (status === "taken") {
        toast({ variant: "destructive", title: `${c.name}: recommended email is already in use`, description: "Pick a different email before sending the request." });
        return;
      }
      if (status !== "available") {
        toast({ variant: "destructive", title: `${c.name}: search the email first`, description: "Click Search and confirm the email is available before requesting the account." });
        return;
      }
    }

    setIsSubmitting(true);
    let succeeded = 0;
    let failed = 0;
    for (const c of targets) {
      const form = forms[c.applicationId];
      try {
        const res = await fetch("/api/college/faculty-account-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerId: c.offerId,
            officialEmail: form.officialEmail.trim(),
          }),
        });
        if (!res.ok) throw new Error();
        succeeded++;
      } catch {
        failed++;
      }
    }
    setIsSubmitting(false);
    setSelected(new Set());
    if (succeeded > 0) toast({ variant: "success", title: `${succeeded} faculty account request${succeeded !== 1 ? "s" : ""} sent to the Webmaster` });
    if (failed > 0) toast({ variant: "destructive", title: `${failed} request${failed !== 1 ? "s" : ""} failed to submit` });
    load();
  }

  async function handleReveal(request: FacultyAccountRequest & { id: string }) {
    setRevealBusyId(request.id);
    try {
      const res = await fetch(`/api/college/faculty-account-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVEAL_CREDENTIALS" }),
      });
      const data = await res.json() as { email?: string; password?: string; error?: string };
      if (!res.ok || !data.password) throw new Error(data.error ?? "Failed to reveal credentials");
      setRevealed({ name: request.candidateName, email: data.email ?? request.assignedEmail ?? "", password: data.password });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to reveal credentials", description: err instanceof Error ? err.message : undefined });
    } finally {
      setRevealBusyId(null);
    }
  }

  const selectedCount = selected.size;
  const activeRequests = useMemo(() => requests.filter((r) => !isPastRequest(r)), [requests]);
  const pastRequests = useMemo(() => requests.filter(isPastRequest), [requests]);
  const visibleRequests = requestScope === "past" ? pastRequests : activeRequests;
  const canReveal = useMemo(
    () => new Set(requests.filter((r) => (r.status === "CREDENTIALS_CREATED" || r.status === "COMPLETED") && r.credentialResult && !r.credentialResult.revealed).map((r) => r.id)),
    [requests]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Faculty Credentials" description="Loading..." />
        <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Faculty Credentials"
        description="Select one or more candidates whose appointment letter has been sent, and request their login from the Webmaster"
      />

      {eligible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <UserCog className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No candidates awaiting an account request</p>
            <p className="text-sm text-muted-foreground mt-1">
              Candidates appear here once their appointment letter has been sent and no faculty account has been requested yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {eligible.map((c) => {
            const isSelected = selected.has(c.applicationId);
            const form = forms[c.applicationId] ?? emptyForm(c.email);
            return (
              <Card key={c.applicationId} className={isSelected ? "border-primary" : undefined}>
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <Checkbox checked={isSelected} onCheckedChange={() => toggleSelected(c.applicationId)} className="mt-1" />
                  <div className="min-w-0">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{c.position} · {c.department}</p>
                  </div>
                </CardHeader>
                {isSelected && (
                  <CardContent className="space-y-3 pt-0">
                    <div className="max-w-sm">
                      <EmailFieldInput
                        label="Recommended Email *"
                        value={form.officialEmail}
                        status={availability[availabilityKey(c.applicationId, "officialEmail")] ?? "unchecked"}
                        onChange={(v) => updateForm(c.applicationId, "officialEmail", v)}
                        onSearch={() => void checkAvailability(c.applicationId, "officialEmail", form.officialEmail)}
                        placeholder="name@college.edu"
                      />
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="sticky bottom-4 flex justify-end">
          <Button size="lg" loading={isSubmitting} onClick={() => void handleSubmit()} className="shadow-lg">
            <KeyRound className="h-4 w-4 mr-2" />
            Request {selectedCount} Faculty Account{selectedCount !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Requests</h2>
            <div className="flex gap-2">
              <Button size="sm" variant={requestScope === "active" ? "default" : "outline"} onClick={() => setRequestScope("active")}>
                Active ({activeRequests.length})
              </Button>
              <Button size="sm" variant={requestScope === "past" ? "default" : "outline"} onClick={() => setRequestScope("past")}>
                Past ({pastRequests.length})
              </Button>
            </div>
          </div>
          {visibleRequests.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {requestScope === "past" ? "No past credential requests yet." : "No active credential requests."}
              </CardContent>
            </Card>
          ) : visibleRequests.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-medium text-sm">{r.candidateName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.designation} · {r.department} · Recommended: {r.officialEmail}
                    {r.assignedEmail && r.assignedEmail !== r.officialEmail ? ` (assigned: ${r.assignedEmail})` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[r.status]}</Badge>
                  {canReveal.has(r.id) && (
                    <Button size="sm" variant="outline" loading={revealBusyId === r.id} onClick={() => void handleReveal(r)}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Reveal Credentials
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!revealed} onOpenChange={(o) => { if (!o) setRevealed(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Faculty Login Credentials</DialogTitle>
            <DialogDescription>
              This is the only time these credentials will be shown — share them with <strong>{revealed?.name}</strong> securely now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-mono select-all">{revealed?.email}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="font-mono select-all">{revealed?.password}</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailFieldInput({
  label,
  value,
  status,
  onChange,
  onSearch,
  placeholder,
}: {
  label: string;
  value: string;
  status: Availability;
  onChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }}
            placeholder={placeholder}
            className={status === "taken" ? "border-red-400 pr-8 focus-visible:ring-red-400" : "pr-8"}
          />
          {status !== "unchecked" && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {status === "available" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {status === "taken" && <XCircle className="h-4 w-4 text-red-600" />}
            </span>
          )}
        </div>
        <Button type="button" variant="outline" onClick={onSearch} disabled={!value.trim() || status === "checking"}>
          {status === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-1.5">Search</span>
        </Button>
      </div>
      {status === "taken" && <p className="text-xs text-red-600">Already in use — pick a different email</p>}
      {status === "available" && <p className="text-xs text-green-600">Available — you can now request the account</p>}
    </div>
  );
}
