"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";

const ROLE_OPTIONS = ["OFFICE", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL"] as const;
type MemberRole = (typeof ROLE_OPTIONS)[number];

function isMemberRole(value: string | null): value is MemberRole {
  return (ROLE_OPTIONS as readonly string[]).includes(value ?? "");
}

export default function NewCollegeMemberPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role");
  const defaultRole: MemberRole = isMemberRole(roleParam) ? roleParam : "OFFICE";

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "12345678", role: defaultRole as string });

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({
        variant: "success",
        title: `${ROLE_LABELS[form.role as MemberRole]} account created`,
        description: `Default password: ${form.password}`,
      });
      router.push("/principal/college-members");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add College Member" description="Create login access for this college" />

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
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
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
                placeholder="member@vishnu.edu.in"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Password</Label>
              <Input
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!form.name || !form.email || !form.password}>Create Account</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
