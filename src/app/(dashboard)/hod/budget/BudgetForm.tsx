"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { BudgetItemsTable } from "@/components/shared/budget/BudgetItemsTable";
import { BUDGET_CATEGORIES, type BudgetRequest, type BudgetRequestItem } from "@/types";

const PRIORITIES = ["High", "Medium", "Low"] as const;

function emptyItem(): BudgetRequestItem {
  return { id: crypto.randomUUID(), itemName: "", specification: "", quantity: 1, unitPrice: 0 };
}

interface BudgetFormProps {
  editingRequest?: BudgetRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}

export function BudgetForm({ editingRequest, onCancel, onSaved }: BudgetFormProps) {
  const lastRemarks = [...(editingRequest?.history ?? [])].reverse().find((h) => h.remarks)?.remarks;
  const editingCategoryIsCustom =
    !!editingRequest && !(BUDGET_CATEGORIES as readonly string[]).includes(editingRequest.category);
  const [category, setCategory] = useState<string>(
    editingCategoryIsCustom ? "Other" : editingRequest?.category ?? ""
  );
  const [customCategory, setCustomCategory] = useState(
    editingCategoryIsCustom ? editingRequest!.category : ""
  );
  const [title, setTitle] = useState(editingRequest?.title ?? "");
  const [priority, setPriority] = useState<string>(editingRequest?.priority ?? "");
  const [requiredBefore, setRequiredBefore] = useState(editingRequest?.requiredBefore ?? "");
  const [items, setItems] = useState<BudgetRequestItem[]>(editingRequest?.items ?? [emptyItem()]);
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setCategory("");
    setCustomCategory("");
    setTitle("");
    setPriority("");
    setRequiredBefore("");
    setItems([emptyItem()]);
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const resolvedCategory = category === "Other" ? customCategory.trim() : category;
    if (!resolvedCategory || !title.trim() || !priority || items.some((i) => !i.itemName.trim())) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        category: resolvedCategory,
        title: title.trim(),
        priority,
        requiredBefore: requiredBefore || undefined,
        items,
      };

      const res = editingRequest
        ? await fetch(`/api/college/budget-requests/${editingRequest.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/college/budget-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to submit budget request");
      }

      toast({ variant: "success", title: editingRequest ? "Budget request resubmitted" : "Budget request submitted" });
      resetForm();
      onSaved();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to submit", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {lastRemarks && (
        <div className="rounded-md border border-orange-300/60 bg-orange-50 p-3 text-sm">
          <p className="font-medium text-orange-800">Returned for correction</p>
          <p className="mt-1 text-orange-700">{lastRemarks}</p>
        </div>
      )}

      {/* Section 1 — Budget Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Budget Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Budget Category <span className="text-destructive">*</span></Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {category === "Other" && (
            <div className="space-y-2">
              <Label>Specify Category <span className="text-destructive">*</span></Label>
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Enter category..."
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Budget Title <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. New CAD workstations for final-year lab"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority <span className="text-destructive">*</span></Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority..." />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Required Before</Label>
              <Input
                type="date"
                value={requiredBefore}
                onChange={(e) => setRequiredBefore(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Item Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Item Details</CardTitle>
        </CardHeader>
        <CardContent>
          <BudgetItemsTable items={items} onChange={setItems} />
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" loading={isSaving}>
          {editingRequest ? "Resubmit Budget Request" : "Submit Budget Request"}
        </Button>
      </div>
    </form>
  );
}
