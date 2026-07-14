"use client";

import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { IndentQuotation } from "@/types";

const MIN_QUOTATIONS = 3;

function emptyQuotation(): IndentQuotation {
  return { id: crypto.randomUUID(), vendorName: "", termsAndConditions: "", price: 0, expectedDeliveryDate: "" };
}

interface QuotationsFormProps {
  quotations: IndentQuotation[];
  selectedQuotationId?: string;
  onChange?: (quotations: IndentQuotation[]) => void;
  onSelectedChange?: (id: string) => void;
  readOnly?: boolean;
}

export function QuotationsForm({ quotations, selectedQuotationId, onChange, onSelectedChange, readOnly = false }: QuotationsFormProps) {
  function updateQuotation(id: string, patch: Partial<IndentQuotation>) {
    onChange?.(quotations.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function addQuotation() {
    onChange?.([...quotations, emptyQuotation()]);
  }

  function removeQuotation(id: string) {
    onChange?.(quotations.filter((q) => q.id !== id));
    if (id === selectedQuotationId) onSelectedChange?.("");
  }

  const list = readOnly ? quotations.filter((q) => q.vendorName || q.price) : quotations;

  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">No quotations added yet{!readOnly && ` — add at least ${MIN_QUOTATIONS}`}.</p>
      )}

      {list.map((q, i) => {
        const isSelected = q.id === selectedQuotationId;
        return (
          <div
            key={q.id}
            className={cn(
              "rounded-lg border p-3 space-y-3",
              isSelected ? "border-green-400 bg-green-50/50" : "bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quotation {i + 1}</span>
                {isSelected && (
                  <Badge className="bg-green-600 hover:bg-green-600 text-white text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Recommended
                  </Badge>
                )}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  {!isSelected && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onSelectedChange?.(q.id)}>
                      Recommend
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeQuotation(q.id)}
                    disabled={quotations.length <= MIN_QUOTATIONS}
                    aria-label="Remove quotation"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              )}
            </div>

            {readOnly ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Vendor</p>
                  <p className="font-medium">{q.vendorName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Price</p>
                  <p className="font-medium">{formatCurrency(q.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected Delivery</p>
                  <p className="font-medium">{q.expectedDeliveryDate ? formatDate(new Date(q.expectedDeliveryDate)) : "—"}</p>
                </div>
                <div className="sm:col-span-3">
                  <p className="text-xs text-muted-foreground">Terms &amp; Conditions</p>
                  <p className="mt-1 rounded bg-background p-2">{q.termsAndConditions || "—"}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Vendor Name</Label>
                  <Input value={q.vendorName} onChange={(e) => updateQuotation(q.id, { vendorName: e.target.value })} placeholder="Vendor / supplier name" />
                </div>
                <div className="space-y-2">
                  <Label>Price</Label>
                  <Input type="number" min={0} value={q.price} onChange={(e) => updateQuotation(q.id, { price: Math.max(0, Number(e.target.value)) })} />
                </div>
                <div className="space-y-2">
                  <Label>Expected Delivery Date</Label>
                  <Input type="date" value={q.expectedDeliveryDate} onChange={(e) => updateQuotation(q.id, { expectedDeliveryDate: e.target.value })} />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <Label>Terms &amp; Conditions</Label>
                  <Textarea value={q.termsAndConditions} onChange={(e) => updateQuotation(q.id, { termsAndConditions: e.target.value })} rows={2} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addQuotation}>
          <Plus className="h-4 w-4 mr-1" />
          Add Quotation
        </Button>
      )}
    </div>
  );
}
