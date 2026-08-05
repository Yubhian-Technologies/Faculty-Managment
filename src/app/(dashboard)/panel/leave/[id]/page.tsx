"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { LeaveRequestV2, LeaveApprovalStepV2, LeaveTypeCodeV2 } from "@/types/leave";

const LT_LABELS: Partial<Record<LeaveTypeCodeV2, string>> = {
  CL: "Casual Leave", SCL: "Special Casual Leave", EL: "Earned Leave",
  ML: "Sick Leave", MAT: "Maternity Leave", FPL: "Family Planning Leave",
  COMP: "Compensatory Leave", LND: "Leave Not Due", QUAR: "Quarantine Leave",
  EOL: "Extraordinary Leave", SAB: "Sabbatical Leave", VAC: "Vacation",
};

const STATUS_STYLES: Record<string, string> = {
  PENDING_HOD:           "bg-yellow-50 text-yellow-700 border-yellow-200",
  PENDING_RATIFICATION:  "bg-blue-50 text-blue-700 border-blue-200",
  PENDING_MANAGEMENT:    "bg-blue-50 text-blue-700 border-blue-200",
  PENDING_MEDICAL_REVIEW:"bg-orange-50 text-orange-700 border-orange-200",
  APPROVED:              "bg-green-50 text-green-700 border-green-200",
  REJECTED:              "bg-red-50 text-red-700 border-red-200",
  RECALLED:              "bg-gray-50 text-gray-600 border-gray-200",
  CANCELLED:             "bg-gray-50 text-gray-500 border-gray-200",
  DRAFT:                 "bg-gray-50 text-gray-500 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_HOD:           "Pending HOD Review",
  PENDING_RATIFICATION:  "Pending Principal Approval",
  PENDING_MANAGEMENT:    "Pending Management Approval",
  PENDING_MEDICAL_REVIEW:"Pending Medical Review",
  APPROVED:              "Approved",
  REJECTED:              "Rejected",
  RECALLED:              "Recalled by HOD",
  CANCELLED:             "Cancelled",
  DRAFT:                 "Draft",
};

function StepIcon({ action }: { action?: string }) {
  if (action === "APPROVED") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (action === "REJECTED") return <XCircle className="h-4 w-4 text-red-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function roleLabel(role?: string) {
  if (role === "VICE_PRINCIPAL") return "Vice Principal";
  if (role === "PRINCIPAL") return "Principal";
  if (role === "HOD") return "HOD";
  return role ?? "Reviewer";
}

export default function LeaveApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [request, setRequest] = useState<LeaveRequestV2 | null>(null);
  const [steps, setSteps] = useState<LeaveApprovalStepV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/leave/applications/${id}`);
        if (!res.ok) {
          toast({ variant: "destructive", title: "Failed to load application" });
          return;
        }
        const d = await res.json() as { request: LeaveRequestV2; steps: LeaveApprovalStepV2[] };
        setRequest(d.request);
        setSteps(d.steps ?? []);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Cancellation failed" });
        return;
      }
      toast({ variant: "success", title: "Application cancelled" });
      router.push("/panel/leave");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-48 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="space-y-4">
        <PageHeader title="Leave Application" description="Application not found" />
        <Button variant="outline" onClick={() => router.push("/panel/leave")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Leave
        </Button>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[request.status] ?? "bg-gray-50 text-gray-500 border-gray-200";
  const statusLabel = STATUS_LABELS[request.status] ?? request.status;
  const canCancel =
    request.status === "PENDING_HOD" ||
    (request.status === "PENDING_RATIFICATION" && request.isOtherRequest && !request.leaveTypeCode);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/panel/leave")}
          className="-ml-1"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <PageHeader
        title={request.isOtherRequest ? "Others" : (request.leaveTypeCode ? LT_LABELS[request.leaveTypeCode] ?? request.leaveTypeCode : "Leave Application")}
        description={`Applied on ${formatDate(request.appliedOn as Parameters<typeof formatDate>[0])}`}
      />

      {/* Status card */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Status</p>
            <Badge variant="outline" className={`text-sm font-medium ${statusStyle}`}>
              {statusLabel}
            </Badge>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Duration</p>
            <p className="text-sm font-semibold">
              {request.computedDays} day{request.computedDays !== 1 ? "s" : ""}
              {request.isHalfDay ? " (half day)" : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Application details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">From</p>
              <p className="font-medium">{formatDate(request.fromDate as Parameters<typeof formatDate>[0])}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">To</p>
              <p className="font-medium">{formatDate(request.toDate as Parameters<typeof formatDate>[0])}</p>
            </div>
          </div>

          {request.isHalfDay && request.halfDaySession && (
            <div>
              <p className="text-xs text-muted-foreground">Session</p>
              <p className="font-medium capitalize">{request.halfDaySession.toLowerCase()}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground">Reason</p>
            <p className="mt-0.5 rounded bg-muted/40 p-2 text-sm">{request.reason}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Leave address</p>
              <p className="font-medium">{request.leaveAddress}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Contact</p>
              <p className="font-medium">{request.contactNumber}</p>
            </div>
          </div>

          {request.substituteArrangement && (
            <div>
              <p className="text-xs text-muted-foreground">Substitute / handover</p>
              <p className="mt-0.5 rounded bg-muted/40 p-2 text-sm">{request.substituteArrangement}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approval timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Applied step */}
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Applied</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(request.appliedOn as Parameters<typeof formatDate>[0])}
                </p>
              </div>
            </div>

            {/* Stage 1 - for "Others" requests the Principal reviews first;
                for everything else the HOD reviews first. */}
            {(() => {
              const stage1Label = request.isOtherRequest ? "Principal" : "HOD";
              const step1 = steps.find((s) => s.sequence === 1);
              if (step1?.action) {
                return (
                  <div className="flex items-start gap-3">
                    <StepIcon action={step1.action} />
                    <div>
                      <p className="text-sm font-medium">
                        {roleLabel(step1.approverRole)} {step1.action === "APPROVED" ? "Approved" : "Rejected"}
                        {step1.approverName && ` - ${step1.approverName}`}
                      </p>
                      {step1.actedOn && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(step1.actedOn as Parameters<typeof formatDate>[0])}
                        </p>
                      )}
                      {step1.comments && (
                        <p className="text-xs mt-1 rounded bg-muted/40 p-1.5">{step1.comments}</p>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex items-start gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {request.status === "CANCELLED" ? `Cancelled before ${stage1Label} review` : `Awaiting ${stage1Label} review`}
                  </p>
                </div>
              );
            })()}

            {/* Stage 2 - only reached once stage 1 approves. For "Others" requests
                this is the HOD picking the actual leave type; for everything else
                it's Principal ratification, which only applies to a few leave types. */}
            {(() => {
              const step1Approved = steps.some((s) => s.sequence === 1 && s.action === "APPROVED");
              const showStage2 = request.isOtherRequest
                ? step1Approved
                : (request.status === "PENDING_RATIFICATION" || request.status === "PENDING_MANAGEMENT" || steps.some((s) => s.sequence === 2));
              if (!showStage2) return null;

              const stage2Label = request.isOtherRequest ? "HOD" : "Principal";
              const step2 = steps.find((s) => s.sequence === 2);
              if (step2?.action) {
                return (
                  <div className="flex items-start gap-3">
                    <StepIcon action={step2.action} />
                    <div>
                      <p className="text-sm font-medium">
                        {roleLabel(step2.approverRole)} {step2.action === "APPROVED" ? "Approved" : "Rejected"}
                      </p>
                      {step2.actedOn && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(step2.actedOn as Parameters<typeof formatDate>[0])}
                        </p>
                      )}
                      {step2.comments && (
                        <p className="text-xs mt-1 rounded bg-muted/40 p-1.5">{step2.comments}</p>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex items-start gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">Awaiting {stage2Label} review</p>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Cancel action */}
      {canCancel && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={() => setCancelOpen(true)}
          >
            Cancel Application
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel Leave Application?"
        description="This will withdraw your application. You can re-apply if needed."
        confirmLabel="Yes, Cancel"
        onConfirm={handleCancel}
        loading={cancelling}
      />
    </div>
  );
}
