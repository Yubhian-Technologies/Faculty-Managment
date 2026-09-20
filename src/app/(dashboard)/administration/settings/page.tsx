"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { Location } from "@/types";

export default function AdministrationSettingsPage() {
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "", address: "" });

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => {
        const loc = (d.locations ?? [])[0] ?? null;
        setLocation(loc);
        if (loc) {
          setForm({ name: loc.name ?? "", city: loc.city ?? "", state: loc.state ?? "", address: loc.address ?? "" });
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load location" }))
      .finally(() => setLoading(false));
  }, []);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  const isValid = form.name.trim().length > 0 && form.city.trim().length > 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!location || !isValid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/locations/${location.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Location information updated" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Settings" description="This location's own configuration" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location Information</CardTitle>
          <CardDescription>
            {location
              ? "Name, city, state and address for this location - shown wherever colleges under it are managed."
              : "No location is assigned to this account."}
          </CardDescription>
        </CardHeader>
        {location && (
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Location Name <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Bhimavaram Campus" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City <span className="text-destructive">*</span></Label>
                  <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Bhimavaram" />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input value={form.state} onChange={(e) => set({ state: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Full address..." />
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" loading={saving} disabled={!isValid}>Save Changes</Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
