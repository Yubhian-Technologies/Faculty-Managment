"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { auth } from "@/lib/firebase/client";
import { downloadOfferLetterPdf } from "@/lib/pdf/downloadOfferLetter";
import { Plus, FileText, CheckCircle2, XCircle, Send, ChevronDown, ChevronUp, UserPlus, Download, Mail } from "lucide-react";
import type { OfferLetter } from "@/types";

type OfferRow = OfferLetter & { id: string };

const STATUS_CONFIG: Record<string, { label: string; color: "default" | "secondary" | "outline" | "destructive"; icon: typeof Send }> = {
  SENT: { label: "Sent", color: "outline", icon: Send },
  ACCEPTED: { label: "Accepted", color: "default", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "destructive", icon: XCircle },
};

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function HodOffersPage() {
  const router = useRouter();
  const [letters, setLetters] = useState<OfferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "ACCEPTED" | "REJECTED" } | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [collegeInfo, setCollegeInfo] = useState<{ name: string; address: string }>({ name: "", address: "" });
  const [revealedPassword, setRevealedPassword] = useState<{ name: string; password: string; employeeId?: string } | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const letters = await fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferRow[] }>).then((d) => d.letters ?? []);
      setLetters(letters);
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

  async function retryProvision(letter: OfferRow) {
    setProvisioning(letter.id);
    try {
      const res = await fetch(`/api/college/offer-letters/${letter.id}/provision`, { method: "POST" });
      const data = await res.json() as { ok?: boolean; alreadyExists?: boolean; employeeId?: string; generatedPassword?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.alreadyExists) {
        toast({ title: "Faculty account already exists" });
      } else if (data.generatedPassword) {
        toast({ variant: "success", title: "Faculty account created", description: `Employee ID: ${data.employeeId ?? ""}` });
        setRevealedPassword({ name: letter.candidateName ?? "the new faculty member", password: data.generatedPassword, employeeId: data.employeeId });
      }
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to create faculty account", description: err instanceof Error ? err.message : undefined });
    } finally {
      setProvisioning(null);
    }
  }

  async function handleAction() {
    if (!actionTarget) return;
    setIsActing(true);
    try {
      await fetch(`/api/college/offer-letters/${actionTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: actionTarget.action }),
      });
      toast({ variant: "success", title: `Status updated to ${actionTarget.action.toLowerCase()}` });
      setActionTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setIsActing(false);
    }
  }

  // Candidate address and interview date aren't stored on the OfferLetter row itself —
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

  async function emailCandidate(letter: OfferRow) {
    setEmailingId(letter.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const { candidateAddress, candidateEmail, interviewDate } = await fetchLetterExtras(letter);
      if (!candidateEmail) throw new Error("Candidate has no email on file");

      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "OFFER_LETTER",
          to: candidateEmail,
          data: {
            candidateName: letter.candidateName,
            candidateAddress,
            position: letter.designation,
            department: letter.department,
            collegeName: collegeInfo.name,
            collegeAddress: collegeInfo.address,
            interviewDate,
            joiningDate: formatDate(letter.joiningDate as Parameters<typeof formatDate>[0]),
            letterDate: formatDate(new Date()),
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to send email");
      toast({ variant: "success", title: "Offer letter emailed", description: `Sent to ${candidateEmail}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to send email", description: err instanceof Error ? err.message : undefined });
    } finally {
      setEmailingId(null);
    }
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
        description="Send offer letters and create faculty logins for candidates in the final decision stage"
        actions={
          <Button onClick={() => router.push("/hod/offers/new")}>
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
                      <Button size="sm" variant="outline" loading={emailingId === letter.id} onClick={() => void emailCandidate(letter)}>
                        <Mail className="h-3.5 w-3.5 mr-1" />
                        Email Candidate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                        loading={provisioning === letter.id}
                        onClick={() => void retryProvision(letter)}
                        title="Retry faculty account creation if it failed when the offer was sent"
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Retry Faculty Account
                      </Button>
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
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!actionTarget}
        onOpenChange={(o) => { if (!o) setActionTarget(null); }}
        title={actionTarget?.action === "ACCEPTED" ? "Mark as Accepted?" : "Mark as Rejected?"}
        description={actionTarget?.action === "ACCEPTED" ? "This will mark the candidate as approved and finalize their hiring." : "Confirm this status change."}
        confirmLabel={actionTarget?.action === "ACCEPTED" ? "Mark Accepted" : "Mark Rejected"}
        variant={actionTarget?.action === "REJECTED" ? "destructive" : "default"}
        onConfirm={handleAction}
        loading={isActing}
      />

      <Dialog open={!!revealedPassword} onOpenChange={(o) => { if (!o) setRevealedPassword(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Faculty Account Created</DialogTitle>
            <DialogDescription>
              A login was created for <strong>{revealedPassword?.name}</strong>
              {revealedPassword?.employeeId ? ` (${revealedPassword.employeeId})` : ""}. Share this temporary password with them securely — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 font-mono text-sm text-center select-all">
            {revealedPassword?.password}
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
