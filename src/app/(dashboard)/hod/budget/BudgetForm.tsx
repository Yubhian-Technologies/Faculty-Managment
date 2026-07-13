"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { BudgetItemsTable, type BudgetItem } from "./BudgetItemsTable";

const BUDGET_CATEGORIES = [
  "Lab Equipment",
  "Furniture",
  "Software",
  "Infrastructure",
  "Maintenance",
  "Events",
  "Research",
  "Training",
  "Library",
  "Electrical",
  "Networking",
  "Other",
] as const;

const PRIORITIES = ["High", "Medium", "Low"] as const;

function emptyItem(): BudgetItem {
  return { id: crypto.randomUUID(), itemName: "", specification: "", quantity: 1, unitPrice: 0 };
}

interface BudgetFormProps {
  onCancel: () => void;
}

export function BudgetForm({ onCancel }: BudgetFormProps) {
  const [category, setCategory] = useState<string>("");
  const [customCategory, setCustomCategory] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [requiredBefore, setRequiredBefore] = useState("");
  const [items, setItems] = useState<BudgetItem[]>([emptyItem()]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    toast({ title: "Budget request submission is not implemented yet." });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Submit Budget Request
        </Button>
      </div>
    </form>
  );
}
