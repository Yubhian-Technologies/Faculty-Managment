"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BudgetItemsTable } from "@/components/shared/budget/BudgetItemsTable";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { BudgetRequest } from "@/types";

interface ReadOnlyFieldProps {
  label: string;
  value: string;
}

function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

interface BudgetRequestDetailProps {
  request: BudgetRequest | null;
  onClose: () => void;
  onActed: () => void;
}

export function BudgetRequestDetail({ request, onClose, onActed }: BudgetRequestDetailProps) {
  const [mode, setMode] = useState<"idle" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!request) return null;

  const isPending = request.status === "PENDING_PRINCIPAL_VERIFICATION";

  function reset() {
    setMode("idle");
    setRemarks("");
  }

  async function act(action: "VERIFY" | "REJECT" | "RETURN") {
    if (!request) return;
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) {
      toast({ variant: "destructive", title: "Remarks are required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/budget-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "VERIFY" ? "Request verified — Level 1 freeze applied" : action === "REJECT" ? "Request rejected" : "Request returned to HOD",
      });
      reset();
      onActed();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{request.title}</DialogTitle>
            <StatusBadge status={request.status} />
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Budget Information */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Budget Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadOnlyField label="Department" value={request.department} />
              <ReadOnlyField label="Requested By" value={request.hodName} />
              <ReadOnlyField label="Budget Category" value={request.category} />
              <ReadOnlyField label="Priority" value={request.priority} />
              <ReadOnlyField
                label="Required Before"
                value={request.requiredBefore ? formatDate(new Date(request.requiredBefore)) : ""}
              />
              <ReadOnlyField label="Submitted" value={formatDate(request.createdAt)} />
            </div>
          </div>

          {/* Item Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Item Details</h3>
            <BudgetItemsTable items={request.items} readOnly />
          </div>

          {/* History */}
          {request.history?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">History</h3>
              <div className="space-y-2">
                {request.history.map((h, i) => (
                  <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                    <div className="flex justify-between font-medium">
                      <span>{h.action}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(h.at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">by {h.byName} ({h.byRole})</p>
                    {h.remarks && <p className="text-muted-foreground">{h.remarks}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {isPending && mode === "idle" && (
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="destructive" onClick={() => setMode("reject")} disabled={isSaving}>
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-orange-300 text-orange-700 hover:bg-orange-50"
              onClick={() => setMode("return")}
              disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Return to HOD
            </Button>
            <Button type="button" onClick={() => void act("VERIFY")} loading={isSaving}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Verify & Freeze (L1)
            </Button>
          </DialogFooter>
        )}

        {isPending && (mode === "reject" || mode === "return") && (
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-sm font-medium">
              Remarks for {mode === "reject" ? "rejection" : "returning to HOD"} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Explain what needs to change or why this is rejected..."
              rows={3}
              disabled={isSaving}
            />
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={reset} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={mode === "reject" ? "destructive" : "default"}
                onClick={() => void act(mode === "reject" ? "REJECT" : "RETURN")}
                loading={isSaving}
              >
                Confirm {mode === "reject" ? "Rejection" : "Return"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
