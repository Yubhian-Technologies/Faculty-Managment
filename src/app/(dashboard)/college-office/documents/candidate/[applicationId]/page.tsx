"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Download, Save, Mail, CheckCircle2, XCircle, KeyRound, Clock, PenLine, Copy } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { downloadDocumentAcknowledgementPdf } from "@/lib/pdf/downloadDocumentAcknowledgement";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate } from "@/lib/utils";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { MarkOfferAcceptedDialog } from "@/components/hiring/MarkOfferAcceptedDialog";
import { FACULTY_ACCOUNT_REQUEST_STATUS_LABELS } from "@/types";
import type { Candidate, CandidateApplication, HiringBatch, OfferLetter, FacultyAccountRequest, CandidateStatus, CandidateStage } from "@/types";
import { getDetailedHiringStatus, DETAILED_HIRING_STATUS_LABELS } from "@/lib/hiringPipeline";

type Phase = "AWAITING_OFFER" | "AWAITING_ACCEPTANCE" | "AWAITING_DOCS" | "NOTIFIED" | "APPOINTMENT_SENT";

// Same joined shape as the overview (college-office/documents/page.tsx) —
// `id` is the applicationId this route is keyed by, `candidateId` is the
// real Candidate id used wherever offer/appointment letters key on it.
// `status`/`currentStage` feed getDetailedHiringStatus() below so the header
// badge matches the exact same label the office overview and HOD/Principal
// pipeline boards show for this candidate.
type DocCandidateView = {
  id: string;
  candidateId: string;
  vacancyRequestId: string;
  name: string;
  email: string;
  department: string;
  position: string;
  batchId?: string;
  status: CandidateStatus;
  currentStage: CandidateStage;
};

export default function CollegeOfficeCandidateDetailPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<DocCandidateView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [batches, setBatches] = useState<Record<string, HiringBatch>>({});
  const [offerByCandidate, setOfferByCandidate] = useState<Record<string, OfferLetter>>({});
  const [appointmentCandidateIds, setAppointmentCandidateIds] = useState<Set<string>>(new Set());
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [newDocInput, setNewDocInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [joiningLetterUrl, setJoiningLetterUrl] = useState("");
  const [notified, setNotified] = useState(false);
  const [persistedVerified, setPersistedVerified] = useState(false);
  const [accountRequestsByOfferId, setAccountRequestsByOfferId] = useState<Record<string, FacultyAccountRequest>>({});
  const [acceptDialogOffer, setAcceptDialogOffer] = useState<OfferLetter | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  function offerKey(candidateId: string, batchId?: string) {
    return `${candidateId}::${batchId ?? ""}`;
  }

  function load() {
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>),
      collegeFetch("/api/college/info").then((r) => r.json() as Promise<{ name: string; address: string }>).catch(() => ({ name: "", address: "" })),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([appsRes, candsRes, batchesRes, infoRes, offersRes, appointmentsRes, accountRequestsRes]) => {
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const application = (appsRes.applications ?? []).find((a) => a.id === applicationId);
        if (!application) {
          setNotFound(true);
          return;
        }
        const person = personMap.get(application.candidateId);
        setCandidate({
          id: application.id,
          candidateId: application.candidateId,
          vacancyRequestId: application.vacancyRequestId,
          name: person?.name ?? "Unknown",
          email: person?.email ?? "",
          department: application.department,
          position: application.position,
          batchId: application.batchId,
          status: application.status,
          currentStage: application.currentStage,
        });

        setBatches(Object.fromEntries((batchesRes.batches ?? []).map((b) => [b.id, b])));
        setCollegeInfo({ name: infoRes.name ?? "", address: infoRes.address ?? "" });
        setAppointmentCandidateIds(new Set((appointmentsRes.letters ?? []).map((l) => l.candidateId)));

        const offerMap: Record<string, OfferLetter> = {};
        for (const letter of offersRes.letters ?? []) {
          if (letter.status === "REJECTED") continue;
          const key = offerKey(letter.candidateId, letter.batchId);
          if (!offerMap[key]) offerMap[key] = letter;
        }
        setOfferByCandidate(offerMap);
        setAccountRequestsByOfferId(Object.fromEntries((accountRequestsRes.requests ?? []).map((r) => [r.offerId, r])));

        setJoiningLetterUrl(application.joiningLetterUrl ?? "");
        setNotified(!!application.documentVerification?.notifiedPrincipalAt);
        setPersistedVerified(application.documentVerification?.allVerified ?? false);

        const batch = (batchesRes.batches ?? []).find((b) => b.id === application.batchId);
        const docs = batch?.requiredDocuments ?? [];
        const saved = application.documentVerification?.checkedDocs ?? {};
        const merged: Record<string, boolean> = {};
        for (const doc of docs) merged[doc] = saved[doc] ?? false;
        for (const [doc, checked] of Object.entries(saved)) if (!(doc in merged)) merged[doc] = checked;
        setChecklist(merged);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidate" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  function phaseFor(c: DocCandidateView): Phase {
    if (appointmentCandidateIds.has(c.candidateId)) return "APPOINTMENT_SENT";
    const offer = offerByCandidate[offerKey(c.candidateId, c.batchId)];
    if (!offer) return "AWAITING_OFFER";
    if (offer.status !== "ACCEPTED") return "AWAITING_ACCEPTANCE";
    if (!persistedVerified || !joiningLetterUrl) return "AWAITING_DOCS";
    // The joining-letter upload notifies the Principal in the same request
    // (see uploadJoiningLetter), so a letter on file means they're notified -
    // this also covers older candidates uploaded before that was automatic.
    return "NOTIFIED";
  }

  // Uploading the joining letter is the last thing Office does before the
  // Principal can act, so notify them in the same request instead of making
  // Office click a separate "Notify Principal" button afterward. Removing an
  // already-uploaded letter (url === "") doesn't re-notify.
  async function uploadJoiningLetter(url: string) {
    if (!candidate) return;
    try {
      const res = await fetch(`/api/college/candidate-applications/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joiningLetterUrl: url, ...(url ? { notifyPrincipalDocsReady: true } : {}) }),
      });
      if (!res.ok) throw new Error();
      setJoiningLetterUrl(url);
      if (url) {
        setNotified(true);
        toast({ variant: "success", title: "Joining letter saved", description: "Principal notified automatically." });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to save joining letter" });
    }
  }

  function toggleDoc(doc: string) {
    setChecklist((prev) => ({ ...prev, [doc]: !prev[doc] }));
  }

  function addDoc() {
    const trimmed = newDocInput.trim();
    if (!trimmed || checklist[trimmed] !== undefined) return;
    setChecklist((prev) => ({ ...prev, [trimmed]: false }));
    setNewDocInput("");
  }

  async function saveChecklist(): Promise<boolean> {
    if (!candidate) return false;
    try {
      const res = await fetch(`/api/college/candidate-applications/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentVerification: { checkedDocs: checklist } }),
      });
      if (!res.ok) throw new Error();
      const requiredDocuments = (candidate.batchId ? batches[candidate.batchId]?.requiredDocuments : undefined) ?? [];
      const allVerified = requiredDocuments.length === 0 || requiredDocuments.every((d) => checklist[d] === true);
      setPersistedVerified(allVerified);
      return true;
    } catch {
      toast({ variant: "destructive", title: "Failed to save checklist" });
      return false;
    }
  }

  async function handleSave() {
    setBusy(true);
    const ok = await saveChecklist();
    if (ok) toast({ variant: "success", title: "Checklist saved" });
    setBusy(false);
  }

  async function handleDownload() {
    if (!candidate) return;
    setBusy(true);
    try {
      const ok = await saveChecklist();
      if (!ok) return;
      await downloadDocumentAcknowledgementPdf(
        {
          collegeName: collegeInfo.name || "College",
          candidateName: candidate.name,
          position: candidate.position,
          department: candidate.department,
          checkedDocs: checklist,
          verifiedByName: user?.name ?? "College Office",
          verifiedAt: new Date().toISOString(),
        },
        candidate.name
      );
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate acknowledgement", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function handleOfferReject() {
    if (!candidate) return;
    const key = offerKey(candidate.candidateId, candidate.batchId);
    const offer = offerByCandidate[key];
    if (!offer) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function fetchLetterExtras(offer: OfferLetter): Promise<{ candidateAddress?: string; candidateEmail?: string; interviewDate?: string }> {
    type CandRes = { candidate?: { email?: string; permanentAddress?: string; residenceAddress?: string } };
    type BatchRes = { batch?: { interviewDate?: Parameters<typeof formatDate>[0] } };
    const [candData, batchData] = await Promise.all([
      fetch(`/api/college/candidates/${offer.candidateId}`).then((r) => r.json() as Promise<CandRes>).catch((): CandRes => ({})),
      fetch(`/api/college/hiring-batches/${offer.batchId}`).then((r) => r.json() as Promise<BatchRes>).catch((): BatchRes => ({})),
    ]);
    const c = candData.candidate;
    return {
      candidateAddress: c?.permanentAddress || c?.residenceAddress,
      candidateEmail: c?.email,
      interviewDate: batchData.batch?.interviewDate ? formatDate(batchData.batch.interviewDate) : undefined,
    };
  }

  async function generateOfferPdf(offer: OfferLetter) {
    setDownloadingId(offer.id);
    try {
      const { candidateAddress, interviewDate } = await fetchLetterExtras(offer);
      await downloadOfferLetterPdf(
        {
          candidateName: offer.candidateName ?? "",
          candidateAddress,
          designation: offer.designation,
          department: offer.department,
          collegeName: collegeInfo.name,
          collegeAddress: collegeInfo.address,
          interviewDate,
          joiningDate: formatDate(offer.joiningDate as Parameters<typeof formatDate>[0]),
          letterDate: formatDate(new Date()),
        },
        offer.candidateName ?? offer.id
      );
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate PDF", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloadingId(null);
    }
  }

  async function composeOfferEmail(offer: OfferLetter) {
    setDownloadingId(offer.id);
    try {
      const [{ candidateAddress, candidateEmail, interviewDate }, ccRes] = await Promise.all([
        fetchLetterExtras(offer),
        fetch(`/api/college/offer-letters/${offer.id}`).then((r) => r.json() as Promise<{ ccEmails?: string[] }>).catch((): { ccEmails?: string[] } => ({})),
      ]);
      if (!candidateEmail) {
        toast({ variant: "destructive", title: "Candidate has no email on file" });
        return;
      }

      await downloadOfferLetterPdf(
        {
          candidateName: offer.candidateName ?? "",
          candidateAddress,
          designation: offer.designation,
          department: offer.department,
          collegeName: collegeInfo.name,
          collegeAddress: collegeInfo.address,
          interviewDate,
          joiningDate: formatDate(offer.joiningDate as Parameters<typeof formatDate>[0]),
          letterDate: formatDate(new Date()),
        },
        offer.candidateName ?? offer.id
      );

      const institution = collegeInfo.name || "the institution";
      const acceptanceUrl = `${window.location.origin}/offer-acceptance/${offer.collegeId}/${offer.id}`;
      const subject = `Offer Letter – ${offer.designation} | ${institution}`;
      const body = `Dear ${offer.candidateName ?? "Candidate"},

Greetings from ${institution}.

We are pleased to offer you the position of ${offer.designation} in the ${offer.department} department, effective from ${formatDate(offer.joiningDate as Parameters<typeof formatDate>[0])}.

The offer letter PDF has just been downloaded to your computer - please attach it to this email before sending.

Please review the Terms & Conditions and confirm your acceptance and date of joining here:
${acceptanceUrl}

Congratulations, and welcome aboard!

Warm regards,
${institution}`;
      const cc = (ccRes.ccEmails ?? []).join(",");
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(candidateEmail)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(gmailUrl, "_blank");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to prepare email", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloadingId(null);
    }
  }

  function copyAcceptanceLink(offer: OfferLetter) {
    const url = `${window.location.origin}/offer-acceptance/${offer.collegeId}/${offer.id}`;
    void navigator.clipboard.writeText(url);
    toast({ variant: "success", title: "Acceptance link copied" });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hiring Pipeline" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (notFound || !candidate) {
    return (
      <div className="space-y-6">
        <Link href="/college-office/documents" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Hiring Pipeline
        </Link>
        <div className="text-center py-12 text-muted-foreground">Candidate not found.</div>
      </div>
    );
  }

  const phase = phaseFor(candidate);
  const docs = Object.keys(checklist);
  const checkedCount = Object.values(checklist).filter(Boolean).length;
  const offerForStatus = offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)];
  const accountRequestForStatus = offerForStatus ? accountRequestsByOfferId[offerForStatus.id] : undefined;
  const detailedStatus = getDetailedHiringStatus({
    applicationStatus: candidate.status,
    currentStage: candidate.currentStage,
    notifiedPrincipalDocsReady: notified,
    joiningLetterUrl,
    offerStatus: offerForStatus?.status as "SENT" | "ACCEPTED" | "REJECTED" | undefined,
    appointmentLetterExists: appointmentCandidateIds.has(candidate.candidateId),
    accountRequestStatus: accountRequestForStatus?.status,
  });

  return (
    <div className="space-y-6">
      <Link
        href={`/college-office/documents/${encodeURIComponent(candidate.department)}/${candidate.vacancyRequestId}`}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Hiring Request
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{candidate.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{candidate.position} · {candidate.department}</p>
          </div>
          {/* Same badge style + label source as the office overview and HOD/Principal pipeline boards. */}
          {detailedStatus ? (
            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
              {DETAILED_HIRING_STATUS_LABELS[detailedStatus]}
            </Badge>
          ) : (
            phase === "AWAITING_DOCS" && <Badge variant="secondary">{checkedCount}/{docs.length} verified</Badge>
          )}
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

          {phase === "AWAITING_ACCEPTANCE" && (() => {
            const offer = offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)];
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    Offer sent — mark it once the candidate confirms acceptance.
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => setAcceptDialogOffer(offer ?? null)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark Accepted
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void handleOfferReject()}>
                      <XCircle className="h-3.5 w-3.5 mr-1.5" /> Mark Rejected
                    </Button>
                  </div>
                </div>
                {offer && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button size="sm" variant="outline" loading={downloadingId === offer.id} onClick={() => void generateOfferPdf(offer)}>
                      <Download className="h-3.5 w-3.5 mr-1" /> Download PDF
                    </Button>
                    <Button size="sm" variant="outline" loading={downloadingId === offer.id} onClick={() => void composeOfferEmail(offer)}>
                      <PenLine className="h-3.5 w-3.5 mr-1" /> Compose Email
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => copyAcceptanceLink(offer)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy Acceptance Link
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}

          {(phase === "AWAITING_DOCS" || phase === "NOTIFIED") && (
            <>
              {docs.length === 0 && (
                <p className="text-sm text-muted-foreground">No required documents set for this batch — add one below.</p>
              )}
              <div className="space-y-2">
                {docs.map((doc) => (
                  <label key={doc} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={checklist[doc]} onCheckedChange={() => toggleDoc(doc)} />
                    {doc}
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  value={newDocInput}
                  onChange={(e) => setNewDocInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDoc(); } }}
                  placeholder="Add another document"
                />
                <Button type="button" variant="outline" size="sm" onClick={addDoc}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleSave()}>
                  <Save className="h-4 w-4 mr-1.5" /> Save
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void handleDownload()}>
                  <Download className="h-4 w-4 mr-1.5" /> Save &amp; Download Acknowledgement
                </Button>
              </div>

              {checkedCount === docs.length && (
                <div className="pt-2 border-t">
                  <DocumentUploadField
                    label="Joining Letter"
                    value={joiningLetterUrl}
                    uploadEndpoint="/api/upload/joining-letter"
                    extraFields={{ candidateId: candidate.candidateId }}
                    onUploaded={(url) => void uploadJoiningLetter(url)}
                    onRemoved={() => void uploadJoiningLetter("")}
                  />
                </div>
              )}

              {phase === "NOTIFIED" && (
                <div className="pt-2 border-t flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Principal notified — awaiting the appointment letter.
                </div>
              )}
            </>
          )}

          {/* Once the appointment letter is out, document verification is done — collapse
              the editable checklist and show only the remaining onboarding steps. */}
          {phase === "APPOINTMENT_SENT" && (() => {
            const offer = offerByCandidate[offerKey(candidate.candidateId, candidate.batchId)];
            const accountRequest = offer ? accountRequestsByOfferId[offer.id] : undefined;
            // The faculty-account/credential request is the final step of the whole
            // hiring pipeline now - CREDENTIALS_CREATED (or COMPLETED) closes it out.
            const credentialsReady = accountRequest?.status === "CREDENTIALS_CREATED" || accountRequest?.status === "COMPLETED";
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Documents verified · Joining letter uploaded
                </div>
                <div className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {credentialsReady ? "Hiring complete — appointment letter sent and faculty account created." : "Appointment letter sent — faculty account setup still pending."}
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
                    <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" asChild>
                      <Link href={`/college-office/settings/faculty-credentials?ids=${candidate.id}`}>
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        Request Faculty Account →
                      </Link>
                    </Button>
                  )
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

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
