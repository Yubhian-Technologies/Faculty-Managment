"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar } from "@/components/shared/Avatar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { FMSUser } from "@/types";

// Where an HOD appoints their department's own office head - a login with the
// SAME authority they have over this department (see UserRole's
// DEPARTMENT_OFFICE doc). One per department.
//
// Reachable only by the real HOD: a Department Office head's own session reads
// "HOD" everywhere, so navConfig hides this item from them via hideForRealRoles
// and both API routes refuse them outright. Appointing a successor is the one
// thing that stays with the HOD - otherwise the appointee could replace the
// person who appointed them.
export default function DepartmentOfficePage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const [pickedUid, setPickedUid] = useState("");

  // react-query rather than a load-in-an-effect, matching the other pages that
  // read this endpoint - it also keeps this file free of the
  // setState-directly-in-an-effect the React Compiler lint rejects.
  const { data: holder = null, isLoading } = useQuery({
    queryKey: ["hod-department-office"],
    queryFn: async () => {
      // Scoped server-side to this HOD's own department(s), so no client-side
      // filter is needed - see the HOD branch of /api/college/users GET.
      const res = await fetch("/api/college/users?role=DEPARTMENT_OFFICE");
      const data = await res.json() as { users?: FMSUser[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      return (data.users ?? []).find((u) => u.isActive !== false) ?? null;
    },
  });

  // The department's own teaching faculty - who the post can be given to.
  // Already scoped server-side to this HOD's department(s), same as the
  // holder query above, so there is nothing to filter here.
  const { data: faculty = [] } = useQuery({
    queryKey: ["hod-department-faculty"],
    queryFn: async () => {
      const res = await fetch("/api/college/users?role=PANEL_MEMBER");
      const data = await res.json() as { users?: FMSUser[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      return (data.users ?? []).filter((u) => u.isActive !== false);
    },
    enabled: showCreate,
  });

  // Employee IDs live on the faculty REGISTER, not on the login: only 113 of
  // 372 faculty logins carry one of their own, while 254 of the remaining 259
  // have it on their facultyMembers record. Reading just the login left most
  // of the dropdown unlabelled. The login list above still decides who can be
  // appointed - the server validates against exactly that - this only fills in
  // the label.
  const { data: employeeIdByUid = new Map<string, string>() } = useQuery({
    queryKey: ["hod-department-faculty-ids"],
    queryFn: async () => {
      const res = await fetch("/api/college/faculty?scope=own");
      const data = await res.json() as { faculty?: { userUid?: string; employeeId?: string }[] };
      const byUid = new Map<string, string>();
      for (const f of data.faculty ?? []) {
        if (f.userUid && f.employeeId?.trim()) byUid.set(f.userUid, f.employeeId.trim());
      }
      return byUid;
    },
    enabled: showCreate,
  });

  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["hod-department-office"] }),
    [queryClient]
  );

  // The post goes to someone who already works here, on the login they
  // already sign in with - no second account, no temporary password to pass
  // along. The server records it on their own `seatRoles`, the same way an
  // HOD's own seat is recorded.
  async function handleAppoint() {
    if (!pickedUid) {
      toast({ variant: "destructive", title: "Pick a faculty member first" });
      return;
    }
    const picked = faculty.find((f) => f.uid === pickedUid);
    setIsCreating(true);
    try {
      const res = await fetch("/api/college/department-office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The department is deliberately not sent - the server takes it from
        // this HOD's own scope, so the post can never land on another one.
        body: JSON.stringify({ uid: pickedUid }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to appoint");
      toast({
        variant: "success",
        title: `${picked?.name ?? "They"} is now Department Office`,
        description: "They sign in as they always have - the department's modules are simply there now.",
      });
      setShowCreate(false);
      setPickedUid("");
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to appoint" });
    } finally {
      setIsCreating(false);
    }
  }

  // Takes the post away, not the person's access: a faculty member keeps their
  // own login and carries on teaching. (A standalone login left over from when
  // this post meant its own account IS the role, so the server deactivates
  // that one instead - never deletes it, since it is referenced by whatever
  // they approved while in post.) Frees the department to appoint someone new.
  async function handleRemove() {
    if (!holder) return;
    setIsRemoving(true);
    try {
      const res = await fetch("/api/college/department-office", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: holder.uid }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove");
      toast({
        variant: "success",
        title: `${holder.name} is no longer Department Office`,
        description: "You can appoint someone else now.",
      });
      setRemoving(false);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove" });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Office"
        description="Appoint one office head for your department, with the same access you have"
        actions={
          !holder && !isLoading ? (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />Add Department Office Head
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : holder ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={holder.name} photoUrl={holder.profilePhotoUrl} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium leading-tight truncate">{holder.name}</p>
                    <Badge variant="secondary">Department Office</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {holder.collegeEmail || holder.email}
                    {holder.department ? ` · ${holder.department}` : ""}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setRemoving(true)}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="py-8 text-center">
              <UserCog className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No Department Office head yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {currentUser?.department
                  ? `Appoint one for ${currentUser.department} — they get the same dashboard and the same access you have.`
                  : "Appoint one for your department — they get the same dashboard and the same access you have."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">What they can do</p>
          <p>
            Everything you can, for this department: faculty and supporting staff, sections, students, subjects,
            teaching assignments, timetable, leave approvals, attendance, budget, indents and hiring.
          </p>
          <p className="pt-1">
            <span className="font-medium text-foreground">What they can&rsquo;t:</span> appoint or remove a Department
            Office head, or assign and remove Sub-HODs. Those stay with you.
          </p>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) setPickedUid(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Department Office Head</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="do-faculty">Faculty Member *</Label>
              <Select value={pickedUid} onValueChange={setPickedUid}>
                <SelectTrigger id="do-faculty">
                  <SelectValue placeholder="Select a faculty member" />
                </SelectTrigger>
                <SelectContent>
                  {faculty.map((f) => {
                    const employeeId = f.employeeId?.trim() || employeeIdByUid.get(f.uid);
                    return (
                      <SelectItem key={f.uid} value={f.uid}>
                        {f.name}
                        {employeeId ? ` (${employeeId})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {faculty.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No faculty in this department yet. Add one from the Faculty page first.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              They keep their own login and their own faculty work - this department&rsquo;s modules
              simply appear alongside it, with the same access you have.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="button" loading={isCreating} disabled={!pickedUid} onClick={() => void handleAppoint()}>
              Appoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => { if (!open) setRemoving(false); }}
        title={`Remove ${holder?.name ?? "this person"} as Department Office?`}
        description="They lose the department's modules immediately and go back to their own faculty access. Their past approvals and records are kept. You can appoint someone else afterwards."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleRemove()}
        loading={isRemoving}
      />
    </div>
  );
}
