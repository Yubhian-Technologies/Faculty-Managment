"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";

export default function NewAdministrationCollegePage() {
  const router = useRouter();
  const [collegeForm, setCollegeForm] = useState({ name: "", address: "", contactEmail: "", contactPhone: "" });
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<typeof collegeForm>) {
    setCollegeForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!collegeForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collegeForm),
      });
      const json = await res.json() as { collegeId?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create college", description: json.error });
        return;
      }
      toast({ variant: "success", title: "College created" });
      router.push("/administration/colleges");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add New College" description="Register a new institution in this location" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">College Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>College Name <span className="text-destructive">*</span></Label>
              <Input
                value={collegeForm.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Vishnu Institute of Technology"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={collegeForm.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Street, City, State"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={collegeForm.contactEmail}
                  onChange={(e) => set({ contactEmail: e.target.value })}
                  placeholder="admin@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input
                  value={collegeForm.contactPhone}
                  onChange={(e) => set({ contactPhone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!collegeForm.name.trim()}>Create College</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
