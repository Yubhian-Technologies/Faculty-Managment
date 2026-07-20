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
import type { College } from "@/types";

export default function NewPrincipalPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const collegeId = params.id;
  const defaultRole = searchParams.get("role") === "VICE_PRINCIPAL" ? "VICE_PRINCIPAL" : "PRINCIPAL";

  const [college, setCollege] = useState<College | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "12345678", role: defaultRole });

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
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load college" }))
      .finally(() => setLoading(false));
  }, [collegeId, router]);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) return;
    setSaving(true);
    try {
      const res = await fetch("/api/administration/principals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, collegeId }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({
        variant: "success",
        title: `${form.role === "PRINCIPAL" ? "Principal" : "Vice Principal"} account created`,
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
        <PageHeader title="Add Principal" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add Principal" description={college ? `For ${college.name}` : undefined} />

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
                  <SelectItem value="PRINCIPAL">Principal</SelectItem>
                  <SelectItem value="VICE_PRINCIPAL">Vice Principal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Dr. Full Name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="principal@vishnu.edu.in"
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
