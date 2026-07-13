"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle, XCircle, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

export type FinanceApprovalAction = "APPROVED" | "REJECTED" | "RETURNED";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  RETURNED: "bg-orange-100 text-orange-800 border-orange-200",
};

interface ApprovalItem {
  id: string;
  status: string;
}

interface ApprovalWorkflowListProps<T extends ApprovalItem> {
  items: T[];
  isLoading: boolean;
  patchUrl: (item: T) => string;
  onChanged: () => void;
  renderSummary: (item: T) => ReactNode;
  renderDetails?: (item: T) => ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  icon?: ReactNode;
}

export function ApprovalWorkflowList<T extends ApprovalItem>({
  items,
  isLoading,
  patchUrl,
  onChanged,
  renderSummary,
  renderDetails,
  emptyTitle = "No requests found",
  emptyDescription,
  icon,
}: ApprovalWorkflowListProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<{ id: string; remarks: string; saving: boolean } | null>(null);

  async function act(item: T, action: FinanceApprovalAction, remarks?: string) {
    setActingId(item.id);
    try {
      const res = await fetch(patchUrl(item), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({ variant: "success", title: `Marked as ${action.toLowerCase()}` });
      setExpandedId(null);
      setReturnState(null);
      onChanged();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setActingId(null);
    }
  }

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>;
  }

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={icon} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        const isActingThis = actingId === item.id;
        const isReturningThis = returnState?.id === item.id;
        const isPending = item.status === "PENDING";

        return (
          <Card key={item.id}>
            <CardHeader
              className="pb-3 cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">{renderSummary(item)}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[item.status])}>
                    {item.status}
                  </Badge>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 space-y-3">
                {renderDetails?.(item)}

                {isPending && !isReturningThis && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      disabled={actingId !== null}
                      loading={isActingThis}
                      onClick={() => void act(item, "APPROVED")}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      disabled={actingId !== null}
                      onClick={() => setReturnState({ id: item.id, remarks: "", saving: false })}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Return for Correction
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actingId !== null}
                      onClick={() => void act(item, "REJECTED")}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {isReturningThis && (
                  <div className="space-y-2 rounded-md border border-orange-300/60 bg-orange-50 p-3 pt-2 border-t">
                    <Label className="text-sm font-medium">Remarks for correction</Label>
                    <Textarea
                      value={returnState.remarks}
                      onChange={(e) => setReturnState((prev) => (prev ? { ...prev, remarks: e.target.value } : prev))}
                      placeholder="What needs to be corrected?"
                      rows={2}
                      disabled={returnState.saving}
                      className="resize-none text-sm bg-background"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-orange-600 hover:bg-orange-700 text-white"
                        loading={returnState.saving}
                        onClick={() => void act(item, "RETURNED", returnState.remarks.trim() || undefined)}
                      >
                        Confirm Return
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReturnState(null)} disabled={returnState.saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
