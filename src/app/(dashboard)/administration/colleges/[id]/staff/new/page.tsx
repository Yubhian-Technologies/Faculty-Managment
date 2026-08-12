"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { getCreatableOfficeRoles } from "@/lib/roles/officeRoles";
import type { College } from "@/types";

const ALL_ROLE_OPTIONS = [
  { value: "PLACEMENT_DEPT", label: "Placement Department" },
  { value: "EXAM_CELL", label: "Exam Cell" },
] as const;

type StaffRole = (typeof ALL_ROLE_OPTIONS)[number]["value"];

function isStaffRole(value: string | null): value is StaffRole {
  return ALL_ROLE_OPTIONS.some((r) => r.value === value);
}

export default function NewCollegeStaffPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const collegeId = params.id;
  const roleParam = searchParams.get("role");
  const defaultRole: StaffRole = isStaffRole(roleParam) ? roleParam : "PLACEMENT_DEPT";

  const [college, setCollege] = useState<College | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "12345678", role: defaultRole as string, dateOfJoining: "" });

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((data) => {
        const c = (data.colleges ?? []).find((x) => x.id === collegeId);
        if (!c) {
          toast({ variant: "destructive", title: "College not found" });
          router.push("/administration/colleges");
          return;
        }
        setCollege(c);
        // This college's type may not offer the role picked from the query
        // param/default (e.g. a School or Polytechnic college doesn't have
        // Exam Cell) - fall back to whatever this type does offer, if any.
        const applicableRoles = getCreatableOfficeRoles(c.type);
        const availableOptions = ALL_ROLE_OPTIONS.filter((r) => applicableRoles.includes(r.value));
        setForm((f) => (
          availableOptions.some((r) => r.value === f.role) ? f : { ...f, role: availableOptions[0]?.value ?? "" }
        ));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load college" }))
      .finally(() => setLoading(false));
  }, [collegeId, router]);

  const roleOptions = ALL_ROLE_OPTIONS.filter((r) => getCreatableOfficeRoles(college?.type).includes(r.value));

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.dateOfJoining) return;
    setSaving(true);
    try {
      const res = await fetch("/api/administration/college-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, collegeId }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      const roleLabel = ALL_ROLE_OPTIONS.find((r) => r.value === form.role)?.label ?? form.role;
      toast({
        variant: "success",
        title: `${roleLabel} account created`,
        description: `Default password: ${form.password}`,
      });
      router.push("/administration/colleges");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Add College Staff" description="Loading…" />
      </div>
    );
  }

  if (roleOptions.length === 0) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Add College Staff" description={college ? `For ${college.name}` : undefined} />
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">
            {college?.name ?? "This college"} has no Placement Department or Exam Cell role for its college type.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add College Staff" description={college ? `For ${college.name}` : undefined} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Role <span className="text-destructive">*</span></Label>
              <Select value={form.role} onValueChange={(v) => set({ role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="staff@vishnu.edu.in"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Password</Label>
              <Input
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Date of Joining <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={form.dateOfJoining}
                onChange={(e) => set({ dateOfJoining: e.target.value })}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!form.name || !form.email || !form.password || !form.dateOfJoining}>Create Account</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
