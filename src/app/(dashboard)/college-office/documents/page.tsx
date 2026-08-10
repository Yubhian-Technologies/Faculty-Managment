"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Save, Mail, CheckCircle2, XCircle, Send, KeyRound, Clock } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { downloadDocumentAcknowledgementPdf } from "@/lib/pdf/downloadDocumentAcknowledgement";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { RequestFacultyAccountDialog } from "@/components/hiring/RequestFacultyAccountDialog";
import { MarkOfferAcceptedDialog } from "@/components/hiring/MarkOfferAcceptedDialog";
import { FACULTY_ACCOUNT_REQUEST_STATUS_LABELS } from "@/types";
import type { Candidate, CandidateApplication, HiringBatch, OfferLetter, FacultyAccountRequest } from "@/types";

type Phase = "AWAITING_OFFER" | "AWAITING_ACCEPTANCE" | "AWAITING_DOCS" | "READY_TO_NOTIFY" | "NOTIFIED" | "APPOINTMENT_SENT";

// Office dashboard joins person fields (name, email) from Candidate onto each
// Principal-approved application — `id` is the applicationId (used for every
// PATCH in this page: documentVerification, joiningLetterUrl,
// notifyPrincipalDocsReady all now live on CandidateApplication, not
// Candidate); `candidateId` is the real Candidate id (used for the offer
// letter link, which OfferLetter still keys on).
type DocCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  department: string;
  position: string;
  batchId?: string;
};

export default function CollegeOfficeDocumentsPage() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<DocCandidateView[]>([]);
  const [batches, setBatches] = useState<Record<string, HiringBatch>>({});
  // Keyed by `${candidateId}::${batchId}` — OfferLetter is still keyed by
  // (candidateId, batchId), not applicationId, so a candidate with more than
  // one application/batch doesn't collide here.
  const [offerByCandidate, setOfferByCandidate] = useState<Record<string, OfferLetter>>({});
  const [appointmentCandidateIds, setAppointmentCandidateIds] = useState<Set<string>>(new Set());
  const [collegeName, setCollegeName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [checklists, setChecklists] = useState<Record<string, Record<string, boolean>>>({});
  const [newDocInputs, setNewDocInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [joiningLetterUrls, setJoiningLetterUrls] = useState<Record<string, string>>({});
  const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set());
  // Persisted (server-confirmed) verification state — deliberately separate from
  // the live `checklists` state below, which changes as checkboxes are ticked but
  // isn't true until "Save" succeeds. Gating on the live state let office notify
  // the Principal before ever saving. See documentVerification.allVerified.
  const [persistedVerified, setPersistedVerified] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<"active" | "closed">("active");
  const [accountRequestsByOfferId, setAccountRequestsByOfferId] = useState<Record<string, FacultyAccountRequest>>({});
  const [requestDialogOffer, setRequestDialogOffer] = useState<OfferLetter | null>(null);
  const [acceptDialogOffer, setAcceptDialogOffer] = useState<OfferLetter | null>(null);

  function offerKey(candidateId: string, batchId?: string) {
    return `${candidateId}::${batchId ?? ""}`;
  }

  function load() {
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>),
      fetch("/api/college/info").then((r) => r.json() as Promise<{ name: string }>).catch(() => ({ name: "" })),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([appsRes, candsRes, batchesRes, infoRes, offersRes, appointmentsRes, accountRequestsRes]) => {
        // Show every Principal-approved application right away — the office dashboard
        // tracks them from decision through offer, verification, and appointment.
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const decisionApps = (appsRes.applications ?? []).filter((a) => a.status !== "REJECTED");
        const views: DocCandidateView[] = decisionApps.map((a) => {
          const person = personMap.get(a.candidateId);
          return {
            id: a.id,
            candidateId: a.candidateId,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            department: a.department,
            position: a.position,
            batchId: a.batchId,
          };
        });
        setCandidates(views);
        setBatches(Object.fromEntries((batchesRes.batches ?? []).map((b) => [b.id, b])));
        setCollegeName(infoRes.name ?? "");
        setAppointmentCandidateIds(new Set((appointmentsRes.letters ?? []).map((l) => l.candidateId)));

        const offerMap: Record<string, OfferLetter> = {};
        for (const letter of offersRes.letters ?? []) {
          if (letter.status === "REJECTED") continue;
          const key = offerKey(letter.candidateId, letter.batchId);
          if (!offerMap[key]) offerMap[key] = letter;
        }
        setOfferByCandidate(offerMap);
        setAccountRequestsByOfferId(Object.fromEntries((accountRequestsRes.requests ?? []).map((r) => [r.offerId, r])));

        setJoiningLetterUrls(Object.fromEntries(decisionApps.map((a) => [a.id, a.joiningLetterUrl ?? ""])));
        setNotifiedIds(new Set(decisionApps.filter((a) => a.documentVerification?.notifiedPrincipalAt).map((a) => a.id)));
        setPersistedVerified(Object.fromEntries(decisionApps.map((a) => [a.id, a.documentVerification?.allVerified ?? false])));

        const initialChecklists: Record<string, Record<string, boolean>> = {};
        for (const a of decisionApps) {
          const batch = (batchesRes.batches ?? []).find((b) => b.id === a.batchId);
          const docs = batch?.requiredDocuments ?? [];
          const saved = a.documentVerification?.checkedDocs ?? {};
          const merged: Record<string, boolean> = {};
          for (const doc of docs) merged[doc] = saved[doc] ?? false;
          for (const [doc, checked] of Object.entries(saved)) if (!(doc in merged)) merged[doc] = checked;
          initialChecklists[a.id] = merged;
        }
        setChecklists(initialChecklists);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // Principal's decision (which moves a candidate into this list) happens
    // server-side in a different session — refetch on refocus so office staff
    // don't sit behind a stale snapshot from before the decision was made.
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function phaseFor(candidate: DocCandidateView): Phase {
    if (appointmentCandidateIds.has(candidate.candidateId)) return "APPOINTMENT_SENT";
    const offer = offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)];
    if (!offer) return "AWAITING_OFFER";
    if (offer.status !== "ACCEPTED") return "AWAITING_ACCEPTANCE";
    if (!persistedVerified[candidate.id] || !joiningLetterUrls[candidate.id]) return "AWAITING_DOCS";
    if (!notifiedIds.has(candidate.id)) return "READY_TO_NOTIFY";
    return "NOTIFIED";
  }

  async function uploadJoiningLetter(applicationId: string, url: string) {
    try {
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joiningLetterUrl: url }),
      });
      if (!res.ok) throw new Error();
      setJoiningLetterUrls((prev) => ({ ...prev, [applicationId]: url }));
      if (url) toast({ variant: "success", title: "Joining letter saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save joining letter" });
    }
  }

  function toggleDoc(applicationId: string, doc: string) {
    setChecklists((prev) => ({
      ...prev,
      [applicationId]: { ...prev[applicationId], [doc]: !prev[applicationId]?.[doc] },
    }));
  }

  function addDoc(applicationId: string) {
    const trimmed = (newDocInputs[applicationId] ?? "").trim();
    if (!trimmed || checklists[applicationId]?.[trimmed] !== undefined) return;
    setChecklists((prev) => ({ ...prev, [applicationId]: { ...prev[applicationId], [trimmed]: false } }));
    setNewDocInputs((prev) => ({ ...prev, [applicationId]: "" }));
  }

  async function saveChecklist(applicationId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentVerification: { checkedDocs: checklists[applicationId] ?? {} } }),
      });
      if (!res.ok) throw new Error();
      // Mirror the server's own allVerified computation (candidate-applications/[id] PATCH)
      // so the UI reflects the just-saved, persisted state immediately.
      const batchId = candidates.find((c) => c.id === applicationId)?.batchId;
      const requiredDocuments = (batchId ? batches[batchId]?.requiredDocuments : undefined) ?? [];
      const checked = checklists[applicationId] ?? {};
      const allVerified = requiredDocuments.length === 0 || requiredDocuments.every((d) => checked[d] === true);
      setPersistedVerified((prev) => ({ ...prev, [applicationId]: allVerified }));
      return true;
    } catch {
      toast({ variant: "destructive", title: "Failed to save checklist" });
      return false;
    }
  }

  async function handleSave(applicationId: string) {
    setBusyId(applicationId);
    const ok = await saveChecklist(applicationId);
    if (ok) toast({ variant: "success", title: "Checklist saved" });
    setBusyId(null);
  }

  async function handleDownload(candidate: DocCandidateView) {
    setBusyId(candidate.id);
    try {
      const ok = await saveChecklist(candidate.id);
      if (!ok) return;
      await downloadDocumentAcknowledgementPdf(
        {
          collegeName: collegeName || "College",
          candidateName: candidate.name,
          position: candidate.position,
          department: candidate.department,
          checkedDocs: checklists[candidate.id] ?? {},
          verifiedByName: user?.name ?? "College Office",
          verifiedAt: new Date().toISOString(),
        },
        candidate.name
      );
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate acknowledgement", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusyId(null);
    }
  }

  async function handleOfferReject(candidate: DocCandidateView) {
    const key = offerKey(candidate.candidateId, candidate.batchId);
    const offer = offerByCandidate[key];
    if (!offer) return;
    setBusyId(candidate.id);
    try {
      const res = await fetch(`/api/college/offer-letters/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED" }),
      });
      if (!res.ok) throw new Error();
      setOfferByCandidate((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast({ variant: "success", title: "Offer marked rejected" });
    } catch {
      toast({ variant: "destructive", title: "Failed to update offer status" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleNotifyPrincipal(applicationId: string) {
    setBusyId(applicationId);
    try {
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyPrincipalDocsReady: true }),
      });
      if (!res.ok) throw new Error();
      setNotifiedIds((prev) => new Set(prev).add(applicationId));
      toast({ variant: "success", title: "Principal notified", description: "They can now send the appointment letter." });
    } catch {
      toast({ variant: "destructive", title: "Failed to notify Principal" });
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Office Dashboard" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const visibleCandidates = candidates.filter((c) => (phaseFor(c) === "APPOINTMENT_SENT") === (scope === "closed"));

  const byDepartment = new Map<string, DocCandidateView[]>();
  for (const c of visibleCandidates) {
    const dept = c.department || "Unassigned";
    if (!byDepartment.has(dept)) byDepartment.set(dept, []);
    byDepartment.get(dept)!.push(c);
  }
  const departments = Array.from(byDepartment.keys()).sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Office Dashboard"
        description={
          scope === "active"
            ? "Principal-approved candidates, grouped by department — send offers, verify documents, and notify the Principal for the appointment letter"
            : "Candidates whose appointment letter has already been sent"
        }
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
          Completed
        </Button>
      </div>

      {visibleCandidates.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {scope === "active" ? "No active hiring requests right now" : "No completed hirings yet"}
        </div>
      )}

      {departments.map((dept) => (
        <div key={dept} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{dept}</h2>
          <div className="space-y-4">
            {byDepartment.get(dept)!.map((candidate) => {
              const phase = phaseFor(candidate);
              const checklist = checklists[candidate.id] ?? {};
              const docs = Object.keys(checklist);
              const checkedCount = Object.values(checklist).filter(Boolean).length;
              const isBusy = busyId === candidate.id;

              return (
                <Card key={candidate.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{candidate.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{candidate.position}</p>
                    </div>
                    {phase === "AWAITING_OFFER" && <Badge variant="secondary">Awaiting Offer</Badge>}
                    {phase === "AWAITING_ACCEPTANCE" && <Badge variant="outline">Awaiting Candidate Acceptance</Badge>}
                    {phase === "AWAITING_DOCS" && <Badge variant="secondary">{checkedCount}/{docs.length} verified</Badge>}
                    {phase === "READY_TO_NOTIFY" && <Badge>Docs Verified</Badge>}
                    {phase === "NOTIFIED" && <Badge variant="secondary">Principal Notified</Badge>}
                    {phase === "APPOINTMENT_SENT" && <Badge className="bg-green-600 hover:bg-green-600">Appointment Letter Sent</Badge>}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {phase === "AWAITING_OFFER" && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          Approved by Principal — send the offer letter to move them forward.
                        </span>
                        <Button size="sm" asChild>
                          <Link href={`/college-office/offers/new?batchId=${candidate.batchId ?? ""}&candidateId=${candidate.candidateId}`}>
                            Send Offer Letter
                          </Link>
                        </Button>
                      </div>
                    )}

                    {phase === "AWAITING_ACCEPTANCE" && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          Offer sent — mark it once the candidate confirms acceptance.
                        </span>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            disabled={busyId === candidate.id}
                            onClick={() => setAcceptDialogOffer(offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)] ?? null)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark Accepted
                          </Button>
                          <Button size="sm" variant="destructive" disabled={busyId === candidate.id} onClick={() => void handleOfferReject(candidate)}>
                            <XCircle className="h-3.5 w-3.5 mr-1.5" /> Mark Rejected
                          </Button>
                        </div>
                      </div>
                    )}

                    {(phase === "AWAITING_DOCS" || phase === "READY_TO_NOTIFY" || phase === "NOTIFIED" || phase === "APPOINTMENT_SENT") && (
                      <>
                        {docs.length === 0 && (
                          <p className="text-sm text-muted-foreground">No required documents set for this batch — add one below.</p>
                        )}
                        <div className="space-y-2">
                          {docs.map((doc) => (
                            <label key={doc} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox checked={checklist[doc]} onCheckedChange={() => toggleDoc(candidate.id, doc)} />
                              {doc}
                            </label>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <Input
                            value={newDocInputs[candidate.id] ?? ""}
                            onChange={(e) => setNewDocInputs((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDoc(candidate.id); } }}
                            placeholder="Add another document"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={() => addDoc(candidate.id)}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="flex gap-2 pt-2 border-t">
                          <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => handleSave(candidate.id)}>
                            <Save className="h-4 w-4 mr-1.5" /> Save
                          </Button>
                          <Button type="button" size="sm" disabled={isBusy} onClick={() => handleDownload(candidate)}>
                            <Download className="h-4 w-4 mr-1.5" /> Save &amp; Download Acknowledgement
                          </Button>
                        </div>

                        {checkedCount === docs.length && (
                          <div className="pt-2 border-t">
                            <DocumentUploadField
                              label="Joining Letter"
                              value={joiningLetterUrls[candidate.id]}
                              uploadEndpoint="/api/upload/joining-letter"
                              extraFields={{ candidateId: candidate.candidateId }}
                              onUploaded={(url) => void uploadJoiningLetter(candidate.id, url)}
                              onRemoved={() => void uploadJoiningLetter(candidate.id, "")}
                            />
                          </div>
                        )}

                        {phase === "READY_TO_NOTIFY" && (
                          <div className="pt-2 border-t">
                            <Button size="sm" disabled={isBusy} onClick={() => void handleNotifyPrincipal(candidate.id)}>
                              <Send className="h-4 w-4 mr-1.5" /> Notify Principal — Ready for Appointment Letter
                            </Button>
                          </div>
                        )}
                        {phase === "NOTIFIED" && (
                          <div className="pt-2 border-t flex items-center gap-1.5 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            Principal notified — awaiting the appointment letter.
                          </div>
                        )}
                        {phase === "APPOINTMENT_SENT" && (() => {
                          const offer = offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)];
                          const accountRequest = offer ? accountRequestsByOfferId[offer.id] : undefined;
                          return (
                            <div className="pt-2 border-t space-y-2">
                              <div className="flex items-center gap-1.5 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                Hiring complete — appointment letter has been sent.
                              </div>
                              {offer && (
                                accountRequest ? (
                                  <Badge variant="outline" className="text-xs">
                                    {accountRequest.status === "COMPLETED" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                                    Faculty Account: {FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[accountRequest.status]}
                                  </Badge>
                                ) : !offer.candidateConfirmedJoiningDate ? (
                                  <p className="text-xs text-muted-foreground" title="The candidate hasn't confirmed a date of joining via the offer acceptance form yet">
                                    Awaiting candidate&apos;s confirmed date of joining before the faculty account can be requested
                                  </p>
                                ) : (
                                  <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setRequestDialogOffer(offer)}>
                                    <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                                    Request Faculty Account
                                  </Button>
                                )
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {requestDialogOffer && (
        <RequestFacultyAccountDialog
          offerId={requestDialogOffer.id}
          candidateName={requestDialogOffer.candidateName ?? ""}
          open={!!requestDialogOffer}
          onOpenChange={(open) => { if (!open) setRequestDialogOffer(null); }}
          onSubmitted={() => { setRequestDialogOffer(null); load(); }}
        />
      )}

      {acceptDialogOffer && (
        <MarkOfferAcceptedDialog
          offerId={acceptDialogOffer.id}
          candidateName={acceptDialogOffer.candidateName ?? ""}
          defaultJoiningDate={acceptDialogOffer.joiningDate}
          open={!!acceptDialogOffer}
          onOpenChange={(open) => { if (!open) setAcceptDialogOffer(null); }}
          onAccepted={() => { setAcceptDialogOffer(null); load(); }}
        />
      )}
    </div>
  );
}
