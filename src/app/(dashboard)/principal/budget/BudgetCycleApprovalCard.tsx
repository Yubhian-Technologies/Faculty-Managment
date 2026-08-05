"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, RotateCcw, FileText, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { BUDGET_TYPE_LABELS, type BudgetCycle } from "@/types";

interface BudgetCycleApprovalCardProps {
  cycle: BudgetCycle;
  onAct: (action: "APPROVE" | "REJECT" | "RETURN", remarks?: string) => Promise<void>;
}

export function BudgetCycleApprovalCard({ cycle, onAct }: BudgetCycleApprovalCardProps) {
  const [mode, setMode] = useState<"idle" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function reset() {
    setMode("idle");
    setRemarks("");
  }

  async function act(action: "APPROVE" | "REJECT" | "RETURN") {
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) return;
    setIsSaving(true);
    try {
      await onAct(action, remarks.trim() || undefined);
      reset();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          Budget Cycle Awaiting Approval
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold">{cycle.title}</p>
            <p className="text-sm text-muted-foreground">
              {cycle.financialYear} · {BUDGET_TYPE_LABELS[cycle.budgetType]} · Released by {cycle.createdByName}
            </p>
          </div>
          <Badge variant="outline">
            {formatDate(new Date(cycle.submissionStartDate))} – {formatDate(new Date(cycle.submissionDeadline))}
          </Badge>
        </div>

        {cycle.description && <p className="text-sm text-muted-foreground">{cycle.description}</p>}

        {cycle.attachmentUrl && (
          <a
            href={cycle.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <FileText className="h-4 w-4" />
            {cycle.attachmentName ?? "View Budget Circular"}
          </a>
        )}

        {mode === "idle" ? (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-2 border-t">
            <Button type="button" variant="destructive" onClick={() => setMode("reject")} disabled={isSaving}>
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              type="button" variant="outline"
              className="border-orange-300 text-orange-700 hover:bg-orange-50"
              onClick={() => setMode("return")} disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Return to Finance
            </Button>
            <Button type="button" onClick={() => void act("APPROVE")} loading={isSaving}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-sm font-medium">
              Remarks for {mode === "reject" ? "rejection" : "returning to Finance"} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Explain what needs to change or why this is rejected..."
              rows={3}
              disabled={isSaving}
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={reset} disabled={isSaving}>Cancel</Button>
              <Button
                type="button"
                variant={mode === "reject" ? "destructive" : "default"}
                onClick={() => void act(mode === "reject" ? "REJECT" : "RETURN")}
                loading={isSaving}
              >
                Confirm {mode === "reject" ? "Rejection" : "Return"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
