"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { COLLEGE_TYPE_LABELS } from "@/types";
import type { CollegeType } from "@/types";

const COLLEGE_TYPES: CollegeType[] = ["ENGINEERING", "SCHOOL", "DENTAL", "PHARMACY", "POLYTECHNIC", "DEGREE"];

type CollegeRow = {
  id: string;
  name: string;
  type?: CollegeType;
  address: string;
  contactEmail: string;
  contactPhone: string;
  [key: string]: unknown;
};

export default function EditCollegePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const collegeId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; type: CollegeType | ""; address: string; contactEmail: string; contactPhone: string }>({ name: "", type: "", address: "", contactEmail: "", contactPhone: "" });

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeRow[] }>)
      .then((data) => {
        const college = (data.colleges ?? []).find((c) => c.id === collegeId);
        if (!college) {
          toast({ variant: "destructive", title: "College not found" });
          router.push("/super-admin/colleges");
          return;
        }
        setForm({
          name: college.name ?? "",
          type: college.type ?? "",
          address: college.address ?? "",
          contactEmail: college.contactEmail ?? "",
          contactPhone: college.contactPhone ?? "",
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load college" }))
      .finally(() => setLoading(false));
  }, [collegeId, router]);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "College name is required" });
      return;
    }
    if (!form.type) {
      toast({ variant: "destructive", title: "College type is required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId,
          name: form.name,
          type: form.type,
          address: form.address,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "College updated" });
      router.push("/super-admin/colleges");
    } catch {
      toast({ variant: "destructive", title: "Failed to update college" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit College" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit College" description="Update institution details" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">College Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">College Name *</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="College name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-type">College Type *</Label>
              <Select value={form.type} onValueChange={(v) => set({ type: v as CollegeType })}>
                <SelectTrigger id="edit-type">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {COLLEGE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{COLLEGE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">Address</Label>
              <Input
                id="edit-address"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="City, State"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Contact Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set({ contactEmail: e.target.value })}
                  placeholder="admin@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Contact Phone</Label>
                <Input
                  id="edit-phone"
                  value={form.contactPhone}
                  onChange={(e) => set({ contactPhone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
