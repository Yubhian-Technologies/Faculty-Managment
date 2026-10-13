"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import type { CertificateRequest } from "@/types";
import { cancelRequest } from "./api";
import { CertificateProgress } from "./CertificateProgress";
import { StatusBadge } from "./StatusBadge";

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

export function RequestList({ request, onCancelled }: { request: CertificateRequest; onCancelled?: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelRequest(request.id);
      toast({ variant: "success", title: "Request cancelled" });
      setConfirmOpen(false);
      onCancelled?.();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't cancel" });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 sm:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">{request.certificateTypeLabel}</h2>
            {request.purpose && <p className="text-sm text-muted-foreground mt-0.5">For: {request.purpose}</p>}
            <p className="text-xs text-muted-foreground mt-1">Submitted {when(request.createdAt)}</p>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <div className="border-t pt-5">
          <CertificateProgress request={request} />
        </div>

        {(request.status === "ISSUED" || request.status === "IN_PROGRESS") && (
          <div className="flex gap-2 border-t pt-5">
            {request.status === "ISSUED" && request.certificateUrl && (
              <Button asChild className="gap-2">
                <a href={request.certificateUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                  Download Certificate
                </a>
              </Button>
            )}
            {request.status === "IN_PROGRESS" && (
              <Button variant="outline" onClick={() => setConfirmOpen(true)} className="gap-2">
                <X className="h-4 w-4" />
                Cancel Request
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel this request?"
        description="This will withdraw your certificate request. Any clearances already given will be discarded - you'll need to submit a fresh request if you need the certificate later."
        confirmLabel="Cancel Request"
        cancelLabel="Keep Request"
        variant="destructive"
        loading={cancelling}
        onConfirm={handleCancel}
      />
    </Card>
  );
}
