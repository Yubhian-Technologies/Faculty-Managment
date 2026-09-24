"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { LocationDepartment, FMSUser } from "@/types";

// These three can cover several departments at once (or all of them) - a
// Dept Head stays single-department (locationDeptId below), since they head
// exactly one and a department can only have one head.
const MULTI_DEPT_ROLES = ["HR_ADMIN", "ADMIN_OFFICE", "ACCOUNTS"];

export default function EditLocationUserPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;
  const user = useAuthStore((s) => s.user);
  const locationId = user?.locationId ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<FMSUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [locationDeptId, setLocationDeptId] = useState("");
  const [locationDeptIds, setLocationDeptIds] = useState<string[]>([]);
  const [allLocationDepts, setAllLocationDepts] = useState(false);
  const [depts, setDepts] = useState<LocationDepartment[]>([]);

  useEffect(() => {
    if (!locationId) return;
    Promise.all([
      fetch(`/api/location/users?locationId=${locationId}`)
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => (d.users ?? []).find((u) => u.uid === uid)),
      fetch("/api/location/departments")
        .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
        .then((d) => setDepts(d.departments ?? [])),
    ])
      .then(([found]) => {
        if (!found) {
          toast({ variant: "destructive", title: "Staff member not found" });
          router.push("/administration/users");
          return;
        }
        setTarget(found);
        setName(found.name ?? "");
        setEmail(found.email ?? "");
        setLocationDeptId((found as unknown as { locationDeptId?: string }).locationDeptId ?? "");
        setLocationDeptIds((found as unknown as { locationDeptIds?: string[] }).locationDeptIds ?? []);
        setAllLocationDepts(!!(found as unknown as { allLocationDepts?: boolean }).allLocationDepts);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff member" }))
      .finally(() => setLoading(false));
  }, [uid, locationId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/location/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          name,
          email,
          ...(target?.role === "LOCATION_DEPT_HEAD" ? { locationDeptId } : {}),
          ...(target && MULTI_DEPT_ROLES.includes(target.role) ? { locationDeptIds, allLocationDepts } : {}),
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Couldn't save", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Saved" });
      router.push("/administration/users");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Edit Staff Member" description="Loading…" />
      </div>
    );
  }
  if (!target) return null;

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader title="Edit Staff Member" description={ROLE_LABELS[target.role] ?? target.role} />
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
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            {target.role === "LOCATION_DEPT_HEAD" && (
              <div className="space-y-2">
                <Label>Assigned Department</Label>
                <Select value={locationDeptId} onValueChange={setLocationDeptId}>
                  <SelectTrigger><SelectValue placeholder="Select department..." /></SelectTrigger>
                  <SelectContent>
                    {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {MULTI_DEPT_ROLES.includes(target.role) && (
              <div className="space-y-2">
                <Label>Departments</Label>
                <p className="text-xs text-muted-foreground">
                  Optional - which department(s) this staff member covers. Leave everything
                  unchecked if they aren&apos;t tied to a specific department.
                </p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={allLocationDepts}
                    onCheckedChange={(checked) => { setAllLocationDepts(!!checked); if (checked) setLocationDeptIds([]); }}
                  />
                  All Departments
                </label>
                {!allLocationDepts && (
                  <div className="space-y-1.5 pl-1">
                    {depts.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={locationDeptIds.includes(d.id)}
                          onCheckedChange={(checked) =>
                            setLocationDeptIds((prev) => (checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)))
                          }
                        />
                        {d.name}
                      </label>
                    ))}
                    {depts.length === 0 && <p className="text-xs text-muted-foreground italic">No departments yet.</p>}
                  </div>
                )}
              </div>
            )}
            {/* Role isn't changed from here - reassigning it can affect singleton-role
                and department-head bookkeeping that only the create flow validates.
                Remove and re-add the person under a different role instead. */}
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/administration/users")}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !email.trim()}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
