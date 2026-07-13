"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requestAmount, type BudgetRequest } from "./mockBudgetRequests";

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
}

export function BudgetRequestDetail({ request, onClose }: BudgetRequestDetailProps) {
  if (!request) return null;

  function handleApprove() {
    toast({ title: "Approval is not implemented yet." });
  }

  function handleReject() {
    toast({ title: "Rejection is not implemented yet." });
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{request.id}</DialogTitle>
            <StatusBadge status={request.status} />
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Budget Information */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Budget Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadOnlyField label="Department" value={request.department} />
              <ReadOnlyField label="Requested By" value={request.requestedBy} />
              <ReadOnlyField label="Budget Category" value={request.category} />
              <ReadOnlyField label="Budget Title" value={request.title} />
              <ReadOnlyField label="Priority" value={request.priority} />
              <ReadOnlyField label="Required Before" value={formatDate(new Date(request.requiredBefore))} />
            </div>
          </div>

          {/* Item Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Item Details</h3>
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Specification</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Qty</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unit Price</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {request.items.map((item) => (
                      <tr key={item.id} className="bg-background">
                        <td className="px-3 py-2">{item.itemName}</td>
                        <td className="px-3 py-2">{item.specification}</td>
                        <td className="px-3 py-2">{item.quantity}</td>
                        <td className="px-3 py-2">{formatCurrency(item.unitPrice)}</td>
                        <td className="px-3 py-2 font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-sm font-medium text-muted-foreground">Grand Total</span>
              <span className="text-base font-semibold">{formatCurrency(requestAmount(request))}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="destructive" onClick={handleReject}>
            <XCircle className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button type="button" onClick={handleApprove}>
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
