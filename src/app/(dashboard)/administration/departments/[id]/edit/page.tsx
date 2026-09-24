"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment } from "@/types";

export default function EditLocationDeptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const user = useAuthStore((s) => s.user);
  const locationId = user?.locationId ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!locationId) return;
    fetch(`/api/location/departments?locationId=${locationId}`)
      .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
      .then((d) => {
        const found = (d.departments ?? []).find((dept) => dept.id === id);
        if (!found) {
          toast({ variant: "destructive", title: "Department not found" });
          router.push("/administration/departments");
          return;
        }
        setName(found.name);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load department" }))
      .finally(() => setLoading(false));
  }, [id, locationId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/location/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, name }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Couldn't save", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Department updated" });
      router.push("/administration/departments");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-sm">
        <PageHeader title="Edit Department" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-5">
      <PageHeader title="Edit Department" description="Rename this location-level administrative department" />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Department</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Department Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Department name" />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/administration/departments")}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
