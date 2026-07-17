"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { IndentItemsTable } from "@/components/shared/indent/IndentItemsTable";
import {
  defaultIndentRequestType,
  INDENT_CATEGORIES,
  INDENT_REQUEST_TYPE_LABELS,
  type IndentItem,
  type IndentRequest,
  type IndentRequestType,
} from "@/types";

function emptyItem(): IndentItem {
  return { id: crypto.randomUUID(), description: "", quantity: 1, estimatedUnitPrice: 0 };
}

interface IndentFormProps {
  editingRequest?: IndentRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}

export function IndentForm({ editingRequest, onCancel, onSaved }: IndentFormProps) {
  const lastRemarks = [...(editingRequest?.history ?? [])].reverse().find((h) => h.remarks)?.remarks;
  const [title, setTitle] = useState(editingRequest?.title ?? "");
  const [category, setCategory] = useState(editingRequest?.category ?? "");
  const [requestType, setRequestType] = useState<IndentRequestType | "">(editingRequest?.requestType ?? "");
  const [items, setItems] = useState<IndentItem[]>(
    editingRequest?.items?.length ? editingRequest.items : [emptyItem()]
  );
  const [isSaving, setIsSaving] = useState(false);

  function handleCategoryChange(value: string) {
    setCategory(value);
    setRequestType(defaultIndentRequestType(value));
  }

  function resetForm() {
    setTitle("");
    setCategory("");
    setRequestType("");
    setItems([emptyItem()]);
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanedItems = items.filter((i) => i.description.trim());
    if (!title.trim() || !category || !requestType || cleanedItems.length === 0) {
      toast({ variant: "destructive", title: "Fill in all required fields", description: "Choose a category, Goods/Non-Goods, and add at least one item with a description." });
      return;
    }
    if (cleanedItems.some((i) => !(i.quantity > 0))) {
      toast({ variant: "destructive", title: "Every item needs a quantity greater than 0" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = { title: title.trim(), category, requestType, items: cleanedItems };

      const res = editingRequest
        ? await fetch(`/api/college/indent-requests/${editingRequest.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/college/indent-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to submit indent request");
      }

      toast({ variant: "success", title: editingRequest ? "Indent resubmitted" : "Indent submitted" });
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Indent Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Title / Purpose <span className="text-destructive">*</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lab consumables restock" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Budget Category <span className="text-destructive">*</span></Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select the category this indent is raised against" />
                </SelectTrigger>
                <SelectContent>
                  {INDENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Goods / Non-Goods <span className="text-destructive">*</span></Label>
              <Select value={requestType} onValueChange={(v) => setRequestType(v as IndentRequestType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GOODS">{INDENT_REQUEST_TYPE_LABELS.GOODS} — sourced via Purchase Dept</SelectItem>
                  <SelectItem value="NON_GOODS">{INDENT_REQUEST_TYPE_LABELS.NON_GOODS} — goes directly to Finance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <IndentItemsTable items={items} onChange={setItems} />
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" loading={isSaving}>
          {editingRequest ? "Resubmit Indent" : "Submit Indent"}
        </Button>
      </div>
    </form>
  );
}
