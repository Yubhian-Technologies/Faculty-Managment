"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment } from "@/types";

const CREATABLE_ROLES = [
  { value: "HR_ADMIN", label: "HR Admin" },
  { value: "ADMIN_OFFICE", label: "Admin Office" },
  { value: "ACCOUNTS", label: "Accounts" },
  { value: "LOCATION_DEPT_HEAD", label: "Dept Head" },
];

export default function NewLocationUserPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("12345678");
  const [role, setRole] = useState("");
  const [locationDeptId, setLocationDeptId] = useState("");
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
      .then((d) => setDepts(d.departments ?? []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !role) return;
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
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {CREATABLE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {role === "LOCATION_DEPT_HEAD" && (
              <div className="space-y-2">
                <Label>Assign to Department <span className="text-destructive">*</span></Label>
                <Select value={locationDeptId} onValueChange={setLocationDeptId}>
                  <SelectTrigger><SelectValue placeholder="Select department..." /></SelectTrigger>
                  <SelectContent>
                    {depts.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
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
          <Button type="submit" loading={saving} disabled={!name || !email || !role}>Create Account</Button>
        </div>
      </form>
    </div>
  );
}
