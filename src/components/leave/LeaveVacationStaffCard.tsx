"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ROUTABLE_REQUESTER_ROLES } from "@/lib/leave/approvalRouting";
import { defaultIsVacation, type LeaveVacationRoles } from "@/lib/leave/staffCategoryRouting";
import { ROLE_LABELS, type FacultyNorms, type UserRole } from "@/types/core";

// Settings > "Vacation / Non-Vacation Staff" - which roles get the vacation
// leave entitlement (CL, SL, SCL, EL-6, OD, summer vacation) and which the
// non-vacation one (CL, SL, EL-30, OD). Saved on its own, like the routing card.
const VALUE = { vacation: "vacation", nonVacation: "non-vacation" } as const;

export function LeaveVacationStaffCard() {
  const [config, setConfig] = useState<LeaveVacationRoles>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/settings/general")
      .then((r) => r.json() as Promise<{ settings: FacultyNorms }>)
      .then(({ settings }) => {
        const saved = settings.leaveVacationRoles ?? {};
        const full: LeaveVacationRoles = {};
        // Faculty default to vacation (teaching designations); see defaultIsVacation.
        for (const role of ROUTABLE_REQUESTER_ROLES) full[role] = saved[role] ?? defaultIsVacation(role, true);
        setConfig(full);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacation staff settings" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      // Store only what differs from the built-in default, so a role left alone
      // keeps following it (notably faculty, whose default depends on each
      // person's own designation).
      const overrides: LeaveVacationRoles = {};
      for (const role of ROUTABLE_REQUESTER_ROLES) {
        if (config[role] !== defaultIsVacation(role, true)) overrides[role] = config[role];
      }
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveVacationRoles: overrides }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
      toast({ variant: "success", title: "Vacation / non-vacation staff saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vacation / Non-Vacation Staff</CardTitle>
        <CardDescription>
          Choose which roles are vacation staff and which are non-vacation, for leave entitlements. A person follows
          the highest seat they hold (a faculty member who is also an HOD follows the HOD setting). Leave balances
          update the next time they are opened. A profile someone edited by hand on the Leave Profile screen keeps
          its manual category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-40 bg-muted animate-pulse rounded-lg" />
        ) : (
          <div className="space-y-3">
            <div className="divide-y rounded-lg border">
              {ROUTABLE_REQUESTER_ROLES.map((role) => (
                <div key={role} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm font-medium">{ROLE_LABELS[role as UserRole]}</span>
                  <Select
                    value={config[role] ? VALUE.vacation : VALUE.nonVacation}
                    onValueChange={(v) => setConfig((prev) => ({ ...prev, [role]: v === VALUE.vacation }))}
                  >
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={VALUE.vacation}>Vacation staff</SelectItem>
                      <SelectItem value={VALUE.nonVacation}>Non-vacation staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Faculty left as vacation staff still follow their own record: a legacy technical designation stays non-vacation.
            </p>
            <div className="flex justify-end">
              <Button onClick={handleSave} loading={isSaving}>Save</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
