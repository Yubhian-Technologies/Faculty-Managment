"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { PermissionRequest } from "@/types/permission";

// Late-attendance permissions waiting on THIS approver. A separate queue from
// the leave one because a permission is a separate record - it carries no
// balance, no coverage and no register entry, so folding it into the leave
// queue's per-request machinery would mean threading "not really a leave"
// through all of it. The route decides whose it shows (own department for an
// HOD, PENDING_PRINCIPAL for the Principal/VP), never one's own.
export function PermissionApprovalQueue() {
  const [rows, setRows] = useState<(PermissionRequest & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/leave/permissions?scope=approvals");
      const data = (await res.json()) as { permissions?: (PermissionRequest & { id: string })[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load permission requests");
      setRows(data.permissions ?? []);
    } catch {
      // Non-fatal: the leave queue above still works, this section just stays empty.
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  async function decide(r: PermissionRequest & { id: string }, approve: boolean) {
    // A rejection has to say why - the requester only sees the outcome
    // otherwise, and the server requires it too.
    let note = "";
    if (!approve) {
      note = (window.prompt("Reason for rejecting this permission request?") ?? "").trim();
      if (!note) return;
    }
    setActingId(r.id);
    try {
      const res = await fetch(`/api/leave/permissions/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: approve ? "APPROVE" : "REJECT", note }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: data.error ?? "Failed" });
        return;
      }
      toast({ variant: "success", title: approve ? "Permission approved" : "Permission rejected" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setActingId(null);
    }
  }

  // Nothing pending is the normal state - stay out of the way rather than
  // showing an empty card under the leave queue.
  if (isLoading || rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">Permission Requests ({rows.length})</h2>
      {rows.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{r.employeeName}</p>
                {r.department && <Badge variant="outline" className="text-[10px]">{r.department}</Badge>}
              </div>
              <p className="flex items-center gap-1.5 text-sm">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {r.date} · {r.fromTime}-{r.toTime}
                <span className="text-muted-foreground">({r.minutes} min)</span>
              </p>
              <p className="text-xs text-muted-foreground">{r.reason}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" disabled={actingId === r.id} onClick={() => void decide(r, false)}>
                <X className="h-4 w-4 mr-1" /> Reject
              </Button>
              <Button size="sm" disabled={actingId === r.id} onClick={() => void decide(r, true)}>
                <Check className="h-4 w-4 mr-1" /> Approve
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
