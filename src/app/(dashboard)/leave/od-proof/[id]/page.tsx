"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { evaluateODProof, OD_PROOF_GRACE_DAYS } from "@/lib/leave/odProof";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest } from "@/types/leave";

// Where a requester uploads proof of duty for an approved On Duty leave, and
// re-uploads after a rejection (see SUBMIT_OD_PROOF in
// applications/[id]/route.ts).
//
// Deliberately outside every role folder, exactly like /leave/revise/[id]: the
// LeaveApplyForm this follows on from is shared by 17 role dashboards, and
// linking them all here beats seventeen identical wrappers.
export default function ODProofPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [proofUrl, setProofUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/leave/applications/${id}`)
      .then((r) => r.json() as Promise<{ request?: LeaveRequest; error?: string }>)
      .then((d) => {
        if (d.request) setRequest(d.request);
        else toast({ variant: "destructive", title: d.error ?? "Couldn't load this leave request" });
      })
      .catch(() => toast({ variant: "destructive", title: "Couldn't load this leave request" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  async function handleSubmit() {
    if (!proofUrl) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_OD_PROOF", odProofUrl: proofUrl }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to submit proof");
      toast({
        variant: "success",
        title: "Proof submitted",
        description: "Your approver has been notified to verify it.",
      });
      router.back();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit proof" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!request) {
    return <p className="text-sm text-muted-foreground">This leave request could not be found.</p>;
  }

  const evaluation = evaluateODProof(request);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proof of Duty"
        description="Upload the certificate, letter or order for this On Duty leave"
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">
              {request.leaveTypeCode ? LEAVE_TYPE_LABELS[request.leaveTypeCode] : "Leave"}
            </p>
            <span className="text-sm text-muted-foreground">
              {formatDate(request.fromDate)} – {formatDate(request.toDate)} · {request.totalDays} day
              {request.totalDays === 1 ? "" : "s"}
            </span>
            {evaluation.state === "PENDING_VERIFICATION" && <Badge variant="pending">Awaiting verification</Badge>}
            {evaluation.state === "VERIFIED" && <Badge variant="approved">Verified</Badge>}
            {evaluation.state === "REJECTED_REUPLOAD" && <Badge variant="rejected">Rejected</Badge>}
            {evaluation.state === "OVERDUE" && <Badge variant="rejected">Overdue — Loss of Pay</Badge>}
          </div>
          {request.reason && <p className="text-sm text-muted-foreground">{request.reason}</p>}

          {evaluation.proofDueBy && (
            <p className="text-xs text-muted-foreground">
              {evaluation.state === "OVERDUE" ? (
                <>
                  Proof was due by{" "}
                  <span className="text-foreground font-medium">{formatDate(evaluation.proofDueBy)}</span>. These days
                  are currently treated as Loss of Pay — uploading proof now and having it verified will reverse that.
                </>
              ) : (
                <>
                  Proof is due within {OD_PROOF_GRACE_DAYS} days of the On Duty period ending, by{" "}
                  <span className="text-foreground font-medium">{formatDate(evaluation.proofDueBy)}</span>. Unproven
                  days are treated as Loss of Pay.
                </>
              )}
            </p>
          )}

          {request.odProofStatus === "REJECTED" && request.odProofRejectionReason && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium">Why it was rejected</p>
              <p className="text-xs text-muted-foreground mt-0.5">{request.odProofRejectionReason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          {evaluation.canUpload ? (
            <>
              {/* DocumentUploadField only uploads and hands back a URL - the
                  PATCH below is what actually attaches it to the request. */}
              <DocumentUploadField
                label="Certificate / letter / duty order"
                value={proofUrl}
                uploadEndpoint="/api/upload/leave-proof"
                extraFields={{ requestId: id }}
                onUploaded={(url) => setProofUrl(url)}
                onRemoved={() => setProofUrl("")}
              />
              <div className="flex justify-end">
                <Button onClick={() => void handleSubmit()} disabled={!proofUrl} loading={isSubmitting}>
                  Submit for Verification
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {evaluation.state === "VERIFIED"
                ? "This proof has been verified — nothing further is needed."
                : evaluation.state === "NOT_DUE"
                  ? "Proof can be uploaded once the On Duty period has ended."
                  : "This leave request isn't awaiting proof of duty."}
            </p>
          )}

          {request.odProofUrl && (
            <p className="text-xs">
              <a
                href={request.odProofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View the document currently on file
              </a>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
