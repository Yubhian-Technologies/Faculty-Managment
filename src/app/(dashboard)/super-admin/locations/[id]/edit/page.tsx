"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { Location } from "@/types";

export default function EditLocationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const locationId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => {
        const loc = (d.locations ?? []).find((l) => l.id === locationId);
        if (!loc) {
          toast({ variant: "destructive", title: "Location not found" });
          router.push("/super-admin/locations");
          return;
        }
        setName(loc.name ?? "");
        setCity(loc.city ?? "");
        setState(loc.state ?? "");
        setAddress(loc.address ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load location" }))
      .finally(() => setLoading(false));
  }, [locationId, router]);

  const isValid = name.trim().length > 0 && city.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/locations/${locationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, city, state, address }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Location updated" });
      router.push("/super-admin/locations");
    } catch {
      toast({ variant: "destructive", title: "Failed to update location" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Edit Location" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader title="Edit Location" description="Update institution location details" />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Location Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Location Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bhimavaram Campus" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City <span className="text-destructive">*</span></Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bhimavaram" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input value={state} onChange={(e) => setState(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full address..." />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!isValid}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
