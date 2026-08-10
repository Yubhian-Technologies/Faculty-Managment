"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { RequestFacultyAccountDialog } from "@/components/hiring/RequestFacultyAccountDialog";
import { MarkOfferAcceptedDialog } from "@/components/hiring/MarkOfferAcceptedDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { Plus, FileText, CheckCircle2, XCircle, Send, ChevronDown, ChevronUp, KeyRound, Clock, Download, PenLine, Copy } from "lucide-react";
import { FACULTY_ACCOUNT_REQUEST_STATUS_LABELS } from "@/types";
import type { OfferLetter, FacultyAccountRequest } from "@/types";

type OfferRow = OfferLetter & { id: string };

const REQUEST_STATUS_COLOR: Record<FacultyAccountRequest["status"], string> = {
  SUBMITTED: "text-amber-700 border-amber-300 bg-amber-50",
  IN_PROGRESS: "text-blue-700 border-blue-300 bg-blue-50",
  CREDENTIALS_CREATED: "text-green-700 border-green-300 bg-green-50",
  COMPLETED: "text-green-700 border-green-300 bg-green-50",
};

const STATUS_CONFIG: Record<string, { label: string; color: "default" | "secondary" | "outline" | "destructive"; icon: typeof Send }> = {
  SENT: { label: "Sent", color: "outline", icon: Send },
  ACCEPTED: { label: "Accepted", color: "default", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "destructive", icon: XCircle },
};

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function CollegeOfficeOffersPage() {
  const router = useRouter();
  const [letters, setLetters] = useState<OfferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [acceptDialogLetter, setAcceptDialogLetter] = useState<OfferRow | null>(null);
  const [requestDialogOffer, setRequestDialogOffer] = useState<OfferRow | null>(null);
  const [appointmentLetterCandidateIds, setAppointmentLetterCandidateIds] = useState<Set<string>>(new Set());
  const [accountRequestsByOfferId, setAccountRequestsByOfferId] = useState<Record<string, FacultyAccountRequest>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });

  async function load() {
    setIsLoading(true);
    try {
      const [letters, appointmentLetters, accountRequests] = await Promise.all([
        fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferRow[] }>).then((d) => d.letters ?? []),
        fetch("/api/college/appointment-letters").then((r) => r.json() as Promise<{ letters: { candidateId: string }[] }>).then((d) => d.letters ?? []).catch(() => []),
        fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>).then((d) => d.requests ?? []).catch(() => []),
      ]);
      setLetters(letters);
      setAppointmentLetterCandidateIds(new Set(appointmentLetters.map((l) => l.candidateId)));
      setAccountRequestsByOfferId(Object.fromEntries(accountRequests.map((r) => [r.offerId, r])));
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    collegeFetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name: string; address: string }>)
      .then((d) => setCollegeInfo({ name: d.name, address: d.address }))
      .catch(() => {});
  }, []);

  async function handleReject() {
    if (!rejectTargetId) return;
    setIsActing(true);
    try {
      const res = await fetch(`/api/college/offer-letters/${rejectTargetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Status updated to rejected" });
      setRejectTargetId(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setIsActing(false);
    }
  }

  // Candidate address and interview date aren't stored on the OfferLetter row itself -
  // fetch them from the candidate/batch docs at generation time (both the download and
  // email flows need the same extras for the letter body).
  async function fetchLetterExtras(letter: OfferRow): Promise<{ candidateAddress?: string; candidateEmail?: string; interviewDate?: string }> {
    type CandRes = { candidate?: { email?: string; permanentAddress?: string; residenceAddress?: string } };
    type BatchRes = { batch?: { interviewDate?: Parameters<typeof formatDate>[0] } };
    const [candData, batchData] = await Promise.all([
      fetch(`/api/college/candidates/${letter.candidateId}`).then((r) => r.json() as Promise<CandRes>).catch((): CandRes => ({})),
      fetch(`/api/college/hiring-batches/${letter.batchId}`).then((r) => r.json() as Promise<BatchRes>).catch((): BatchRes => ({})),
    ]);
    const candidate = candData.candidate;
    return {
      candidateAddress: candidate?.permanentAddress || candidate?.residenceAddress,
      candidateEmail: candidate?.email,
      interviewDate: batchData.batch?.interviewDate ? formatDate(batchData.batch.interviewDate) : undefined,
    };
  }

  async function generatePdf(letter: OfferRow) {
    setDownloadingId(letter.id);
    try {
      const { candidateAddress, interviewDate } = await fetchLetterExtras(letter);
      await downloadOfferLetterPdf(
        {
          candidateName: letter.candidateName ?? "",
          candidateAddress,
          designation: letter.designation,
          department: letter.department,
          collegeName: collegeInfo.name,
          collegeAddress: collegeInfo.address,
          interviewDate,
          joiningDate: formatDate(letter.joiningDate as Parameters<typeof formatDate>[0]),
          letterDate: formatDate(new Date()),
        },
        letter.candidateName ?? letter.id
      );
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate PDF", description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloadingId(null);
    }
  }

  // Opens a pre-filled Gmail draft the way the HOD's interview call letter does.
  // Gmail's compose URL has no way to attach a file programmatically, so this
  // downloads the PDF first (same file generatePdf() produces) and lands it in
  // the browser's downloads - office just drags it into the draft before sending.
  async function composeEmail(letter: OfferRow) {
    setDownloadingId(letter.id);
    try {
      const [{ candidateAddress, candidateEmail, interviewDate }, ccRes] = await Promise.all([
        fetchLetterExtras(letter),
        // Recomputed live, not read off `letter` - covers letters sent before
        // ccEmails was persisted, and stays correct if the roster changed since.
        fetch(`/api/college/offer-letters/${letter.id}`).then((r) => r.json() as Promise<{ ccEmails?: string[] }>).catch((): { ccEmails?: string[] } => ({})),
      ]);
      if (!candidateEmail) {
        toast({ variant: "destructive", title: "Candidate has no email on file" });
        return;
      }

      await downloadOfferLetterPdf(
        {
          candidateName: letter.candidateName ?? "",
          candidateAddress,
          designation: letter.designation,
          department: letter.department,
          collegeName: collegeInfo.name,
          collegeAddress: collegeInfo.address,
          interviewDate,
          joiningDate: formatDate(letter.joiningDate as Parameters<typeof formatDate>[0]),
          letterDate: formatDate(new Date()),
        },
        letter.candidateName ?? letter.id
      );

      const institution = collegeInfo.name || "the institution";
      const acceptanceUrl = `${window.location.origin}/offer-acceptance/${letter.collegeId}/${letter.id}`;
      const subject = `Offer Letter – ${letter.designation} | ${institution}`;
      const body = `Dear ${letter.candidateName ?? "Candidate"},

Greetings from ${institution}.

We are pleased to offer you the position of ${letter.designation} in the ${letter.department} department, effective from ${formatDate(letter.joiningDate as Parameters<typeof formatDate>[0])}.

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

  function copyAcceptanceLink(letter: OfferRow) {
    const url = `${window.location.origin}/offer-acceptance/${letter.collegeId}/${letter.id}`;
    void navigator.clipboard.writeText(url);
    toast({ variant: "success", title: "Acceptance link copied" });
  }

  const counts = {
    sent: letters.filter((l) => l.status === "SENT").length,
    accepted: letters.filter((l) => l.status === "ACCEPTED").length,
    rejected: letters.filter((l) => l.status === "REJECTED").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offer Letters"
        description="Send offer letters and request candidate login credentials once the appointment letter is released"
        actions={
          <Button onClick={() => router.push("/college-office/offers/new")}>
            <Plus className="h-4 w-4 mr-1" />
            Send Offer Letter
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {[
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

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : letters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No offer letters yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Send offer letters for candidates in the final decision stage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {letters.map((letter) => {
            const cfg = STATUS_CONFIG[letter.status] ?? STATUS_CONFIG.SENT;
            const Icon = cfg.icon;
            const isExpanded = expandedId === letter.id;

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
                      <div>
                        <p className="text-xs text-muted-foreground">Sent By</p>
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
                      <Button size="sm" variant="outline" loading={downloadingId === letter.id} onClick={() => void generatePdf(letter)}>
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Download PDF
                      </Button>
                      <Button size="sm" variant="outline" loading={downloadingId === letter.id} onClick={() => void composeEmail(letter)}>
                        <PenLine className="h-3.5 w-3.5 mr-1" />
                        Compose Email
                      </Button>
                      {letter.status === "SENT" && (
                        <Button size="sm" variant="ghost" onClick={() => copyAcceptanceLink(letter)}>
                          <Copy className="h-3.5 w-3.5 mr-1" />
                          Copy Acceptance Link
                        </Button>
                      )}
                      {letter.status === "ACCEPTED" && (() => {
                        const accountRequest = accountRequestsByOfferId[letter.id];
                        if (accountRequest) {
                          return (
                            <Badge variant="outline" className={REQUEST_STATUS_COLOR[accountRequest.status]}>
                              {accountRequest.status === "COMPLETED" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                              {FACULTY_ACCOUNT_REQUEST_STATUS_LABELS[accountRequest.status]}
                            </Badge>
                          );
                        }
                        if (!appointmentLetterCandidateIds.has(letter.candidateId)) {
                          return (
                            <Badge variant="secondary" title="The Principal needs to generate the appointment letter first">
                              Awaiting Appointment Letter
                            </Badge>
                          );
                        }
                        if (!letter.candidateConfirmedJoiningDate) {
                          return (
                            <Badge variant="secondary" title="The candidate hasn't confirmed a date of joining yet">
                              Awaiting Candidate Confirmation
                            </Badge>
                          );
                        }
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            onClick={() => setRequestDialogOffer(letter)}
                            title="Ask the Webmaster to create the candidate's login"
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1" />
                            Request Faculty Account
                          </Button>
                        );
                      })()}
                      {letter.status === "SENT" && (
                        <>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setAcceptDialogLetter(letter)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Mark Accepted
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setRejectTargetId(letter.id)}>
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Mark Rejected
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!rejectTargetId}
        onOpenChange={(o) => { if (!o) setRejectTargetId(null); }}
        title="Mark as Rejected?"
        description="Confirm this status change."
        confirmLabel="Mark Rejected"
        variant="destructive"
        onConfirm={handleReject}
        loading={isActing}
      />

      {acceptDialogLetter && (
        <MarkOfferAcceptedDialog
          offerId={acceptDialogLetter.id}
          candidateName={acceptDialogLetter.candidateName ?? ""}
          defaultJoiningDate={acceptDialogLetter.joiningDate}
          open={!!acceptDialogLetter}
          onOpenChange={(open) => { if (!open) setAcceptDialogLetter(null); }}
          onAccepted={() => { setAcceptDialogLetter(null); void load(); }}
        />
      )}

      {requestDialogOffer && (
        <RequestFacultyAccountDialog
          offerId={requestDialogOffer.id}
          candidateName={requestDialogOffer.candidateName ?? ""}
          open={!!requestDialogOffer}
          onOpenChange={(open) => { if (!open) setRequestDialogOffer(null); }}
          onSubmitted={() => { setRequestDialogOffer(null); void load(); }}
        />
      )}
    </div>
  );
}
