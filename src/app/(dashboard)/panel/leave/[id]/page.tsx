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
  ML: "Medical Leave", MAT: "Maternity Leave", FPL: "Family Planning Leave",
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
  const canCancel = request.status === "PENDING_HOD";

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
        title={LT_LABELS[request.leaveTypeCode] ?? request.leaveTypeCode}
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

            {/* HOD step */}
            {(() => {
              const hodStep = steps.find((s) => s.approverRole === "HOD");
              if (hodStep?.action) {
                return (
                  <div className="flex items-start gap-3">
                    <StepIcon action={hodStep.action} />
                    <div>
                      <p className="text-sm font-medium">
                        HOD {hodStep.action === "APPROVED" ? "Approved" : "Rejected"}
                        {hodStep.approverName && ` — ${hodStep.approverName}`}
                      </p>
                      {hodStep.actedOn && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(hodStep.actedOn as Parameters<typeof formatDate>[0])}
                        </p>
                      )}
                      {hodStep.comments && (
                        <p className="text-xs mt-1 rounded bg-muted/40 p-1.5">{hodStep.comments}</p>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex items-start gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {request.status === "CANCELLED" ? "Cancelled before HOD review" : "Awaiting HOD review"}
                  </p>
                </div>
              );
            })()}

            {/* Principal step (if progressed) */}
            {(request.status === "PENDING_RATIFICATION" ||
              request.status === "PENDING_MANAGEMENT" ||
              request.status === "APPROVED" ||
              request.status === "REJECTED" && steps.some((s) => s.sequence === 2)) && (() => {
              const principalStep = steps.find((s) => s.sequence === 2);
              if (principalStep?.action) {
                return (
                  <div className="flex items-start gap-3">
                    <StepIcon action={principalStep.action} />
                    <div>
                      <p className="text-sm font-medium">
                        {principalStep.approverRole === "VICE_PRINCIPAL" ? "Vice Principal" : "Principal"}{" "}
                        {principalStep.action === "APPROVED" ? "Approved" : "Rejected"}
                      </p>
                      {principalStep.actedOn && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(principalStep.actedOn as Parameters<typeof formatDate>[0])}
                        </p>
                      )}
                      {principalStep.comments && (
                        <p className="text-xs mt-1 rounded bg-muted/40 p-1.5">{principalStep.comments}</p>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex items-start gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">Awaiting Principal review</p>
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
