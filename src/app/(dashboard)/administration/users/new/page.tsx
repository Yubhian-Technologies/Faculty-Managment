"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { LEVEL_LABELS } from "@/types";
import type { LocationDepartment, FMSUser } from "@/types";

const CREATABLE_ROLES = [
  { value: "HR_ADMIN", label: "HR Admin" },
  { value: "ADMIN_OFFICE", label: "Admin Office" },
  { value: "ACCOUNTS", label: "Accounts" },
  { value: "LOCATION_DEPT_HEAD", label: "Dept Head" },
] as const;

const SINGLETON_ROLES = ["HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS"];

export default function NewLocationUserPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState("");
  const [locationDeptId, setLocationDeptId] = useState("");
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [existingUsers, setExistingUsers] = useState<FMSUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/location/users")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => setExistingUsers(d.users ?? [])),
      fetch("/api/location/departments")
        .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
        .then((d) => setDepts(d.departments ?? [])),
    ])
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, []);

  // Map role → holder name for already-filled singleton roles
  const filledSingletons = existingUsers.reduce<Record<string, string>>((acc, u) => {
    if (SINGLETON_ROLES.includes(u.role)) acc[u.role] = u.name;
    return acc;
  }, {});

  // Departments that already have a dept head assigned
  const deptsTaken = new Set(
    existingUsers
      .filter((u) => u.role === "LOCATION_DEPT_HEAD" && (u as { locationDeptId?: string }).locationDeptId)
      .map((u) => (u as { locationDeptId?: string }).locationDeptId!)
  );

  const allSingletonsFilled = SINGLETON_ROLES.every((r) => filledSingletons[r]);
  const selectedRoleHolder = role && filledSingletons[role] ? filledSingletons[role] : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !role) return;
    if (SINGLETON_ROLES.includes(role) && filledSingletons[role]) {
      toast({ variant: "destructive", title: "Role already assigned", description: `${filledSingletons[role]} already holds this role.` });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/location/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, password, role,
          locationId: user?.locationId ?? "",
          locationDeptId: role === "LOCATION_DEPT_HEAD" ? locationDeptId : undefined,
        }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Staff member created", description: `Default password: ${password}` });
      router.push("/administration/users");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader title="Add Staff Member" description="Create a location-level staff account" />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Staff Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@vishnu.edu.in" />
            </div>
            <div className="space-y-2">
              <Label>Role <span className="text-destructive">*</span></Label>
              <Select
                value={role}
                onValueChange={(v) => { setRole(v); setLocationDeptId(""); }}
                disabled={loadingUsers}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingUsers ? "Loading..." : "Select role..."} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                      {LEVEL_LABELS[2]}
                    </SelectLabel>
                    {CREATABLE_ROLES.map((r) => {
                      const isFilled = SINGLETON_ROLES.includes(r.value) && !!filledSingletons[r.value];
                      return (
                        <SelectItem key={r.value} value={r.value} disabled={isFilled}>
                          <span className={isFilled ? "text-muted-foreground" : ""}>
                            {r.label}
                            {isFilled && ` — assigned to ${filledSingletons[r.value]}`}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {selectedRoleHolder && (
                <p className="text-sm text-destructive">
                  This role is already assigned to <strong>{selectedRoleHolder}</strong>. Only one person can hold this role.
                </p>
              )}
              {!loadingUsers && allSingletonsFilled && (
                <p className="text-xs text-muted-foreground">
                  All singleton roles (HR Admin, Admin Office, Accounts) are filled. You can still add Dept Heads.
                </p>
              )}
            </div>

            {role === "LOCATION_DEPT_HEAD" && (
              <div className="space-y-2">
                <Label>Assign to Department <span className="text-destructive">*</span></Label>
                <Select value={locationDeptId} onValueChange={setLocationDeptId}>
                  <SelectTrigger><SelectValue placeholder="Select department..." /></SelectTrigger>
                  <SelectContent>
                    {depts.map((d) => {
                      const hasDeptHead = deptsTaken.has(d.id);
                      return (
                        <SelectItem key={d.id} value={d.id} disabled={hasDeptHead}>
                          <span className={hasDeptHead ? "text-muted-foreground" : ""}>
                            {d.name}{hasDeptHead && " — head assigned"}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Default Password</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button
            type="submit"
            loading={saving}
            disabled={
              !name || !email || !role ||
              (SINGLETON_ROLES.includes(role) && !!filledSingletons[role]) ||
              (role === "LOCATION_DEPT_HEAD" && !locationDeptId)
            }
          >
            Create Account
          </Button>
        </div>
      </form>
    </div>
  );
}
