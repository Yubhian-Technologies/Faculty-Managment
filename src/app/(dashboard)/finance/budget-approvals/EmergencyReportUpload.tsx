"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Upload, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate } from "@/lib/utils";
import type { BudgetRequest } from "@/types";

// Non-Goods emergency requests Finance has already approved — Finance can attach a
// report here (any file form) for the requesting Principal/VP to view. Goods requests
// don't appear: they continue into the existing Purchase Clearance pipeline instead.
export function EmergencyReportUpload() {
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/budget-requests?status=FINANCE_APPROVED")
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setRequests((d.requests ?? []).filter((r) => r.isEmergency && r.emergencyType === "NON_GOODS")))
      .catch(() => toast({ variant: "destructive", title: "Failed to load emergency requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleFileChosen(request: BudgetRequest, file: File | undefined) {
    if (!file) return;
    setUploadingId(request.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload/budget-report", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const err = (await uploadRes.json()) as { error?: string };
        throw new Error(err.error ?? "Upload failed");
      }
      const { url, fileName } = (await uploadRes.json()) as { url: string; fileName: string };

      const patchRes = await collegeFetch(`/api/college/budget-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportFileUrl: url, reportFileName: fileName }),
      });
      if (!patchRes.ok) {
        const err = (await patchRes.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to attach report");
      }

      toast({ variant: "success", title: "Report sent to Principal" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to upload report", description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploadingId(null);
    }
  }

  if (isLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>;
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        title="No emergency reports pending"
        description="Approved Non-Goods emergency requests awaiting a report will appear here."
        icon={<AlertTriangle className="h-8 w-8" />}
      />
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((item) => {
        const isUploadingThis = uploadingId === item.id;
        return (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold text-sm">{item.department}</span>
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Emergency · Non-Goods
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.title} — requested by {item.hodName} on {formatDate(item.createdAt)}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {item.reportFileUrl ? (
                <a
                  href={item.reportFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  {item.reportFileName ?? "View Report"} — sent to Principal
                </a>
              ) : (
                <div>
                  <input
                    ref={(el) => { fileInputRefs.current[item.id] = el; }}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => void handleFileChosen(item, e.target.files?.[0])}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    loading={isUploadingThis}
                    disabled={uploadingId !== null && !isUploadingThis}
                    onClick={() => fileInputRefs.current[item.id]?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Send Report to Principal
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
