"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import {
  ROUTABLE_REQUESTER_ROLES, allowedStagesForRole, defaultApproverStage, type LeaveApprovalRouting,
} from "@/lib/leave/approvalRouting";
import { ROLE_LABELS, type FacultyNorms, type UserRole } from "@/types/core";
import { LEAVE_APPROVER_STAGE_LABELS, type LeaveApproverStage } from "@/types/leave";
import { formatDateTime } from "@/lib/utils";

interface RoutingRoleChange {
  role: UserRole;
  from: LeaveApproverStage;
  to: LeaveApproverStage;
}

interface RoutingChangeLogEntry {
  id: string;
  performedByName?: string;
  performedByRole?: string;
  timestamp?: unknown;
  details?: { changes?: RoutingRoleChange[] };
}

// Settings > "Leave Approval Routing" - who a leave request goes to first,
// per requester role. Saved on its own (not with the page's main Save button)
// so it's obvious what a click here changes.
export function LeaveApprovalRoutingCard() {
  const [routing, setRouting] = useState<LeaveApprovalRouting>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<RoutingChangeLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  function loadHistory() {
    setHistoryLoading(true);
    // The shared college-wide audit log, filtered down to just this card's
    // own action - it also carries unrelated entries (ratios, teaching
    // hours, ...) from the same Settings page's main Save button, which
    // would otherwise bury "who changed the routing and when" in noise.
    fetch("/api/college/audit-logs")
      .then((r) => r.json() as Promise<{ logs?: (RoutingChangeLogEntry & { action?: string })[] }>)
      .then((d) => setHistory((d.logs ?? []).filter((l) => l.action === "LEAVE_ROUTING_UPDATED")))
      .catch(() => {}) // non-critical - the routing itself still loaded/saved fine
      .finally(() => setHistoryLoading(false));
  }

  useEffect(() => {
    fetch("/api/college/settings/general")
      .then((r) => r.json() as Promise<{ settings: FacultyNorms }>)
      .then(({ settings }) => {
        const saved = settings.leaveApprovalRouting ?? {};
        const full: LeaveApprovalRouting = {};
        for (const role of ROUTABLE_REQUESTER_ROLES) full[role] = saved[role] ?? defaultApproverStage(role);
        setRouting(full);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave routing" }))
      .finally(() => setIsLoading(false));
    loadHistory();
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveApprovalRouting: routing }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
      toast({ variant: "success", title: "Leave approval routing saved" });
      // Refreshed right away, not just on next page load, so whoever's
      // looking at this card sees their own change (and anyone else's) land
      // in the history immediately.
      loadHistory();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Leave Approval Routing</CardTitle>
          <CardDescription>
            Choose who a leave request goes to first, for each role. It applies to leave submitted from now on -
            requests already pending stay where they are. &ldquo;Head of Department&rdquo; only takes effect for someone
            who belongs to a department; otherwise their request goes to the Principal. &ldquo;Principal&rdquo; and
            &ldquo;Vice Principal&rdquo; route to that person specifically - the Principal can still step in on a
            Vice-Principal-routed request, but not the other way around.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          title="View routing change history"
          aria-label="View routing change history"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-40 bg-muted animate-pulse rounded-lg" />
        ) : (
          <div className="space-y-3">
            <div className="divide-y rounded-lg border">
              {ROUTABLE_REQUESTER_ROLES.map((role) => {
                const allowed = allowedStagesForRole(role);
                return (
                  <div key={role} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-medium">{ROLE_LABELS[role as UserRole]}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">goes to</span>
                      <Select
                        value={routing[role] ?? defaultApproverStage(role)}
                        onValueChange={(v) => setRouting((prev) => ({ ...prev, [role]: v as LeaveApproverStage }))}
                        disabled={allowed.length === 1}
                      >
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {allowed.map((s) => (
                            <SelectItem key={s} value={s}>{LEAVE_APPROVER_STAGE_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              The Principal&apos;s own leave always goes to Management - there is no one else above them in the college.
            </p>
            <div className="flex justify-end">
              <Button onClick={handleSave} loading={isSaving}>Save Routing</Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Routing Change History</DialogTitle>
            <DialogDescription>Who changed the Leave Approval Routing, and when.</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded-lg" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <div className="divide-y rounded-lg border max-h-96 overflow-y-auto">
              {history.map((entry) => (
                <div key={entry.id} className="px-3 py-2 text-sm space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">
                        {entry.performedByRole ? (ROLE_LABELS[entry.performedByRole as UserRole] ?? entry.performedByRole) : "Someone"}
                      </span>
                      {entry.performedByName ? ` (${entry.performedByName})` : ""} changed the routing
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(entry.timestamp as Parameters<typeof formatDateTime>[0])}
                    </span>
                  </div>
                  {/* Older entries saved before this per-role diff existed have
                      no `changes` array - the summary line above is all they
                      can show. */}
                  {entry.details?.changes && entry.details.changes.length > 0 && (
                    <div className="space-y-0.5 pl-3 border-l-2">
                      {entry.details.changes.map((c) => (
                        <p key={c.role} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{ROLE_LABELS[c.role] ?? c.role}</span>
                          {": "}
                          {LEAVE_APPROVER_STAGE_LABELS[c.from] ?? c.from}
                          {" → "}
                          <span className="text-foreground">{LEAVE_APPROVER_STAGE_LABELS[c.to] ?? c.to}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
