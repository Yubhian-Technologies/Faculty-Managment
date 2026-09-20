"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import {
  ROUTABLE_REQUESTER_ROLES, allowedStagesForRole, defaultApproverStage, type LeaveApprovalRouting,
} from "@/lib/leave/approvalRouting";
import { ROLE_LABELS, type FacultyNorms, type UserRole } from "@/types/core";
import { LEAVE_APPROVER_STAGE_LABELS, type LeaveApproverStage } from "@/types/leave";

// Settings > "Leave Approval Routing" - who a leave request goes to first,
// per requester role. Saved on its own (not with the page's main Save button)
// so it's obvious what a click here changes.
export function LeaveApprovalRoutingCard() {
  const [routing, setRouting] = useState<LeaveApprovalRouting>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave Approval Routing</CardTitle>
        <CardDescription>
          Choose who a leave request goes to first, for each role. It applies to leave submitted from now on -
          requests already pending stay where they are. &ldquo;Head of Department&rdquo; only takes effect for someone
          who belongs to a department; otherwise their request goes to the Principal / Vice Principal.
        </CardDescription>
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
    </Card>
  );
}
