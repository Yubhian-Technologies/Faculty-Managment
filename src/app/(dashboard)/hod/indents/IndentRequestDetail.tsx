"use client";

import { Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { IndentItemsTable } from "@/components/shared/indent/IndentItemsTable";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, type IndentRequest } from "@/types";

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

interface IndentRequestDetailProps {
  request: IndentRequest | null;
  onClose: () => void;
  onEditRequest: (request: IndentRequest) => void;
}

export function IndentRequestDetail({ request, onClose, onEditRequest }: IndentRequestDetailProps) {
  if (!request) return null;

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{request.title}</DialogTitle>
            <IndentStatusBadge status={request.status} />
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Indent Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadOnlyField label="Department" value={request.department} />
              <ReadOnlyField label="Submitted" value={formatDate(request.createdAt)} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">Item Details</h3>
              <span className="text-sm font-semibold">{formatCurrency(indentItemsTotal(request.items))}</span>
            </div>
            <IndentItemsTable items={request.items} readOnly />
          </div>

          {request.quotations?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Vendor Quotations</h3>
              <QuotationsForm quotations={request.quotations} selectedQuotationId={request.selectedQuotationId} readOnly />
            </div>
          )}

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

        {request.status === "RETURNED_TO_HOD" && (
          <DialogFooter className="pt-2">
            <Button type="button" onClick={() => onEditRequest(request)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit & Resubmit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
