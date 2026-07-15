"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";

export default function NewLocationPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Andhra Pradesh");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !city.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, city, state, address }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Location created" });
      router.push("/management/locations");
    } catch {
      toast({ variant: "destructive", title: "Failed to create location" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader title="Add Location" description="Create a new institution location" />
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
          <Button type="submit" loading={saving} disabled={!name.trim() || !city.trim()}>Create Location</Button>
        </div>
      </form>
    </div>
  );
}
