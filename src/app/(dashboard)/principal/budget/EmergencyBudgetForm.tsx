"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/useToast";
import { BudgetCategorySection, emptyBudgetCategoryGroup } from "@/components/shared/budget/BudgetCategorySection";
import {
  NON_RECURRING_CATEGORIES,
  RECURRING_CATEGORIES,
  type BudgetCategoryGroup,
  type BudgetRequest,
  type EmergencyRequestType,
} from "@/types";

function nowForDateTimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EmergencyBudgetFormProps {
  editingRequest?: BudgetRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}

export function EmergencyBudgetForm({ editingRequest, onCancel, onSaved }: EmergencyBudgetFormProps) {
  const lastRemarks = [...(editingRequest?.history ?? [])].reverse().find((h) => h.remarks)?.remarks;
  const [emergencyType, setEmergencyType] = useState<EmergencyRequestType>(
    editingRequest?.emergencyType ?? (editingRequest?.recurring?.length ? "NON_GOODS" : "GOODS")
  );
  const [department, setDepartment] = useState(editingRequest?.department ?? "");
  const [emergencyReason, setEmergencyReason] = useState(editingRequest?.emergencyReason ?? "");
  const [academicYear, setAcademicYear] = useState(editingRequest?.academicYear ?? "");
  const [title, setTitle] = useState(editingRequest?.title ?? "");
  const [requestDate, setRequestDate] = useState(editingRequest?.requestDate ?? nowForDateTimeInput());
  const [goodsGroups, setGoodsGroups] = useState<BudgetCategoryGroup[]>(
    editingRequest?.nonRecurring?.length ? editingRequest.nonRecurring : [emptyBudgetCategoryGroup()]
  );
  const [nonGoodsGroups, setNonGoodsGroups] = useState<BudgetCategoryGroup[]>(
    editingRequest?.recurring?.length ? editingRequest.recurring : [emptyBudgetCategoryGroup()]
  );
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const groups = emergencyType === "GOODS" ? goodsGroups : nonGoodsGroups;
    const cleaned = groups.filter((g) => g.items.some((i) => i.title.trim()));

    if (!academicYear.trim() || !title.trim() || !requestDate || !department.trim() || !emergencyReason.trim() || cleaned.length === 0) {
      toast({
        variant: "destructive",
        title: "Fill in all required fields",
        description: `Add at least one item under ${emergencyType === "GOODS" ? "Non Recurring" : "Recurring"}.`,
      });
      return;
    }
    if (cleaned.some((g) => !g.category.trim())) {
      toast({ variant: "destructive", title: "Every category with items needs a category selected" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        isEmergency: true,
        department: department.trim(),
        emergencyReason: emergencyReason.trim(),
        academicYear: academicYear.trim(),
        title: title.trim(),
        requestDate,
        nonRecurring: emergencyType === "GOODS" ? cleaned : [],
        recurring: emergencyType === "NON_GOODS" ? cleaned : [],
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
        throw new Error(err.error ?? "Failed to submit emergency budget request");
      }

      toast({ variant: "success", title: editingRequest ? "Emergency request resubmitted" : "Emergency request submitted to Management" });
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
          <CardTitle className="text-base">Request Type</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={emergencyType}
            onValueChange={(v) => setEmergencyType(v as EmergencyRequestType)}
            className="sm:grid-cols-2"
          >
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value="GOODS" id="type-goods" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Goods</span>
                <span className="block text-xs text-muted-foreground">Equipment / physical items (Non-Recurring categories)</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value="NON_GOODS" id="type-non-goods" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Non-Goods</span>
                <span className="block text-xs text-muted-foreground">Services / staffing / other (Recurring categories)</span>
              </span>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Budget Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Budget Title <span className="text-destructive">*</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Urgent lab equipment replacement" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Department <span className="text-destructive">*</span></Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Mechanical Engineering" />
            </div>
            <div className="space-y-2">
              <Label>Academic Year <span className="text-destructive">*</span></Label>
              <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="e.g. 2026-27" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date of Budget Request <span className="text-destructive">*</span></Label>
            <Input type="datetime-local" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Emergency Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={emergencyReason}
              onChange={(e) => setEmergencyReason(e.target.value)}
              placeholder="Explain why this request can't wait for the regular HOD → Principal → Finance cycle..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {emergencyType === "GOODS" ? (
            <BudgetCategorySection label="Non Recurring (Goods)" categories={NON_RECURRING_CATEGORIES} groups={goodsGroups} onChange={setGoodsGroups} />
          ) : (
            <BudgetCategorySection label="Recurring (Non-Goods)" categories={RECURRING_CATEGORIES} groups={nonGoodsGroups} onChange={setNonGoodsGroups} />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" loading={isSaving}>
          {editingRequest ? "Resubmit Emergency Request" : "Submit Emergency Request"}
        </Button>
      </div>
    </form>
  );
}
