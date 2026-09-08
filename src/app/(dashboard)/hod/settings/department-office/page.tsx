"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const [form, setForm] = useState({ name: "", collegeEmail: "", email: "", employeeId: "", phone: "", password: "" });

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

  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["hod-department-office"] }),
    [queryClient]
  );

  async function handleCreate() {
    if (!form.name.trim() || !form.collegeEmail.trim() || form.password.length < 8) {
      toast({ variant: "destructive", title: "Name, college email and an 8+ character password are required" });
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `department` is deliberately omitted - the server fills it from this
        // HOD's own scope, and refuses when they head more than one so the
        // account can never land against the wrong department.
        body: JSON.stringify({ ...form, role: "DEPARTMENT_OFFICE" }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create the account");
      toast({
        variant: "success",
        title: `${form.name} can now sign in as Department Office`,
        description: "They have the same access you do for this department.",
      });
      setShowCreate(false);
      setForm({ name: "", collegeEmail: "", email: "", employeeId: "", phone: "", password: "" });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to create the account" });
    } finally {
      setIsCreating(false);
    }
  }

  // Deactivates the login rather than deleting it: this repo has no user-delete
  // path anywhere, and the account is referenced by whatever they approved or
  // recorded while in post. Frees the department to appoint someone new.
  async function handleRemove() {
    if (!holder) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/college/users/${holder.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove");
      toast({
        variant: "success",
        title: `${holder.name} is no longer Department Office`,
        description: "Their login is deactivated. You can appoint someone else now.",
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Department Office Head</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="do-name">Full Name *</Label>
              <Input id="do-name" value={form.name} placeholder="Dr. Ramesh Kumar"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {/* College email is the login username, same rule every other staff
                account follows (see /api/college/users POST). */}
            <div className="space-y-2">
              <Label htmlFor="do-college-email">College Email *</Label>
              <Input id="do-college-email" type="email" autoComplete="off" value={form.collegeEmail}
                placeholder="office@college.edu"
                onChange={(e) => setForm((f) => ({ ...f, collegeEmail: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="do-email">Personal Email</Label>
              <Input id="do-email" type="email" autoComplete="off" value={form.email} placeholder="Optional"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="do-employee-id">Employee ID</Label>
              <Input id="do-employee-id" value={form.employeeId} placeholder="Optional"
                onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="do-phone">Phone</Label>
              <Input id="do-phone" type="tel" autoComplete="off" value={form.phone} placeholder="Optional"
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="do-password">Temporary Password *</Label>
              <Input id="do-password" type="password" autoComplete="new-password" value={form.password}
                placeholder="Min 8 characters"
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Share this with them to log in for the first time.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="button" loading={isCreating} onClick={() => void handleCreate()}>Create Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => { if (!open) setRemoving(false); }}
        title={`Remove ${holder?.name ?? "this person"} as Department Office?`}
        description="Their login is deactivated and they lose access immediately. Their past approvals and records are kept. You can appoint someone else afterwards."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleRemove()}
        loading={isRemoving}
      />
    </div>
  );
}
