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
import { evaluateLeaveCertificate } from "@/lib/leave/leaveCertificate";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest } from "@/types/leave";

// Where a requester attaches a post-leave certificate for an approved SL or
// SCL request, and re-uploads after a rejection (see SUBMIT_CERTIFICATE in
// applications/[id]/route.ts). Unlike On Duty proof, nothing here ever
// affects pay - it's for the record either way. SL's is purely optional;
// SCL's is chased by the approver if left outstanding (see the
// scl-missing-certificate scope and REQUEST_CERTIFICATE action) but is
// otherwise identical in consequence - still never blocking, never LOP.
//
// Deliberately outside every role folder, same convention as
// /leave/od-proof/[id] and /leave/revise/[id]: the LeaveApplyForm this
// follows on from is shared by 17 role dashboards.
export default function LeaveCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [certificateUrl, setCertificateUrl] = useState("");
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
    if (!certificateUrl) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_CERTIFICATE", certificateUrl }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to submit certificate");
      toast({
        variant: "success",
        title: "Certificate submitted",
        description: "Your approver has been notified to verify it.",
      });
      router.back();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit certificate" });
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

  const evaluation = evaluateLeaveCertificate(request);
  const typeLabel = request.leaveTypeCode ? LEAVE_TYPE_LABELS[request.leaveTypeCode] : "Leave";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificate"
        description={`Attach a supporting certificate for this ${typeLabel} (${evaluation.required ? "required" : "optional"})`}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{typeLabel}</p>
            <span className="text-sm text-muted-foreground">
              {formatDate(request.fromDate)} – {formatDate(request.toDate)} · {request.totalDays} day
              {request.totalDays === 1 ? "" : "s"}
            </span>
            {evaluation.state === "PENDING_VERIFICATION" && <Badge variant="pending">Awaiting verification</Badge>}
            {evaluation.state === "VERIFIED" && <Badge variant="approved">Verified</Badge>}
            {evaluation.state === "REJECTED_REUPLOAD" && <Badge variant="rejected">Rejected</Badge>}
          </div>
          {request.reason && <p className="text-sm text-muted-foreground">{request.reason}</p>}

          <p className="text-xs text-muted-foreground">
            {evaluation.required
              ? "This is required, but never affects whether this leave is paid - your approver may follow up if it's missing."
              : "This is entirely optional - attaching a certificate never affects whether this leave is paid."}
          </p>

          {request.certificateStatus === "REJECTED" && request.certificateRejectionReason && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium">Why it was rejected</p>
              <p className="text-xs text-muted-foreground mt-0.5">{request.certificateRejectionReason}</p>
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
                label="Certificate"
                value={certificateUrl}
                uploadEndpoint="/api/upload/leave-proof"
                extraFields={{ requestId: id }}
                onUploaded={(url) => setCertificateUrl(url)}
                onRemoved={() => setCertificateUrl("")}
              />
              <div className="flex justify-end">
                <Button onClick={() => void handleSubmit()} disabled={!certificateUrl} loading={isSubmitting}>
                  Submit for Verification
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {evaluation.state === "VERIFIED"
                ? "This certificate has been verified — nothing further is needed."
                : evaluation.state === "NOT_DUE"
                  ? `A certificate can be attached once the ${typeLabel} period has ended.`
                  : "This leave request isn't awaiting a certificate."}
            </p>
          )}

          {request.certificateUrl && (
            <p className="text-xs">
              <a
                href={request.certificateUrl}
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
