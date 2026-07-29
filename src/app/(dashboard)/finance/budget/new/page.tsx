"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { BUDGET_TYPE_LABELS, type BudgetType } from "@/types";

function defaultFinancialYear(): string {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // FY starts April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export default function NewBudgetCyclePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [financialYear, setFinancialYear] = useState(defaultFinancialYear());
  const [budgetType, setBudgetType] = useState<BudgetType>("ANNUAL");
  const [submissionStartDate, setSubmissionStartDate] = useState("");
  const [submissionDeadline, setSubmissionDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !financialYear.trim() || !budgetType || !submissionStartDate || !submissionDeadline) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    if (new Date(submissionDeadline).getTime() <= new Date(submissionStartDate).getTime()) {
      toast({ variant: "destructive", title: "Submission deadline must be after the start date" });
      return;
    }

    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/budget-cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          financialYear: financialYear.trim(),
          budgetType,
          submissionStartDate,
          submissionDeadline,
          description: description.trim(),
          allowLateSubmission,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to release budget cycle");
      }
      toast({ variant: "success", title: "Budget cycle released", description: "Sent to the Principal for approval." });
      router.push("/finance/budget");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to release budget cycle", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Release Budget Cycle"
        description="Announce an institution-wide budget cycle for the Principal to approve. Once approved, every active department automatically gets a pending budget to fill in and submit."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budget Cycle Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Budget Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Budget 2026-27" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Financial Year *</Label>
                <Input value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} placeholder="2026-27" />
              </div>
              <div className="space-y-2">
                <Label>Budget Type *</Label>
                <Select value={budgetType} onValueChange={(v) => setBudgetType(v as BudgetType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(BUDGET_TYPE_LABELS) as [BudgetType, string][]).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Submission Start Date *</Label>
                <Input type="date" value={submissionStartDate} onChange={(e) => setSubmissionStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Submission Deadline *</Label>
                <Input type="date" value={submissionDeadline} onChange={(e) => setSubmissionDeadline(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description / Instructions</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Any guidance for departments preparing their budgets..."
                rows={4}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="allowLateSubmission"
                checked={allowLateSubmission}
                onCheckedChange={(v) => setAllowLateSubmission(v === true)}
              />
              <Label htmlFor="allowLateSubmission" className="font-normal cursor-pointer">
                Allow late submission after the deadline
              </Label>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Release Budget Cycle</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
