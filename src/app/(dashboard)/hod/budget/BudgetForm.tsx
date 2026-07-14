"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { BudgetCategorySection, emptyBudgetCategoryGroup } from "@/components/shared/budget/BudgetCategorySection";
import {
  NON_RECURRING_CATEGORIES,
  RECURRING_CATEGORIES,
  type BudgetCategoryGroup,
  type BudgetRequest,
} from "@/types";

function nowForDateTimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface BudgetFormProps {
  editingRequest?: BudgetRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}

export function BudgetForm({ editingRequest, onCancel, onSaved }: BudgetFormProps) {
  const lastRemarks = [...(editingRequest?.history ?? [])].reverse().find((h) => h.remarks)?.remarks;
  const [academicYear, setAcademicYear] = useState(editingRequest?.academicYear ?? "");
  const [title, setTitle] = useState(editingRequest?.title ?? "");
  const [requestDate, setRequestDate] = useState(editingRequest?.requestDate ?? nowForDateTimeInput());
  const [nonRecurring, setNonRecurring] = useState<BudgetCategoryGroup[]>(
    editingRequest?.nonRecurring?.length ? editingRequest.nonRecurring : [emptyBudgetCategoryGroup()]
  );
  const [recurring, setRecurring] = useState<BudgetCategoryGroup[]>(
    editingRequest?.recurring?.length ? editingRequest.recurring : [emptyBudgetCategoryGroup()]
  );
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setAcademicYear("");
    setTitle("");
    setRequestDate(nowForDateTimeInput());
    setNonRecurring([emptyBudgetCategoryGroup()]);
    setRecurring([emptyBudgetCategoryGroup()]);
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanedNonRecurring = nonRecurring.filter((g) => g.items.some((i) => i.title.trim()));
    const cleanedRecurring = recurring.filter((g) => g.items.some((i) => i.title.trim()));
    const totalItems = cleanedNonRecurring.length + cleanedRecurring.length;

    if (!academicYear.trim() || !title.trim() || !requestDate || totalItems === 0) {
      toast({ variant: "destructive", title: "Fill in all required fields", description: "Add at least one item under Non Recurring or Recurring." });
      return;
    }
    if ([...cleanedNonRecurring, ...cleanedRecurring].some((g) => !g.category.trim())) {
      toast({ variant: "destructive", title: "Every category with items needs a category selected" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        academicYear: academicYear.trim(),
        title: title.trim(),
        requestDate,
        nonRecurring: cleanedNonRecurring,
        recurring: cleanedRecurring,
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
            <Label>Budget Title <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Department budget proposal"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Academic Year <span className="text-destructive">*</span></Label>
              <Input
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="e.g. 2026-27"
              />
            </div>
            <div className="space-y-2">
              <Label>Date of Budget Request <span className="text-destructive">*</span></Label>
              <Input
                type="datetime-local"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Non Recurring */}
      <Card>
        <CardContent className="pt-6">
          <BudgetCategorySection
            label="Non Recurring"
            categories={NON_RECURRING_CATEGORIES}
            groups={nonRecurring}
            onChange={setNonRecurring}
          />
        </CardContent>
      </Card>

      {/* Section 3 — Recurring */}
      <Card>
        <CardContent className="pt-6">
          <BudgetCategorySection
            label="Recurring"
            categories={RECURRING_CATEGORIES}
            groups={recurring}
            onChange={setRecurring}
          />
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
