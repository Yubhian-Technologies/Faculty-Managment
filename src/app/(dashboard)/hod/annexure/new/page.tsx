"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";

export default function NewAnnexureStaffPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "12345678", annexure: "" });

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.annexure) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, role: "ANNEXURE" }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create account", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Account created", description: `Default password: ${form.password}` });
      router.push("/hod/annexure");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add Staff" description="Create login access with an Annexure reference" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email ID <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="staff@vishnu.edu.in"
              />
            </div>
            <div className="space-y-2">
              <Label>Password <span className="text-destructive">*</span></Label>
              <Input
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Annexure <span className="text-destructive">*</span></Label>
              <Input
                value={form.annexure}
                onChange={(e) => set({ annexure: e.target.value })}
                placeholder="e.g. 1"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!form.name || !form.email || !form.password || !form.annexure}
              >
                Create Account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
