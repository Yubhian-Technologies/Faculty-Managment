"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Location } from "@/types";

export default function NewCollegePage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations((d.locations ?? []).filter((l) => l.isActive)))
      .catch(() => {});
  }, []);

  const isValid = name.trim().length >= 2 && !!locationId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, locationId, address, contactEmail, contactPhone }),
      });
      const json = await res.json() as { collegeId?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create college", description: json.error });
        return;
      }
      toast({ variant: "success", title: "College created", description: `ID: ${json.collegeId}` });
      router.push("/super-admin/colleges");
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add College"
        description="Register a new institution and assign it to a location"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">College Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">

            <div className="space-y-2">
              <Label>Location <span className="text-destructive">*</span></Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.length === 0 && (
                    <SelectItem value="_none" disabled>No locations found — add a location first</SelectItem>
                  )}
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} — {l.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {locations.length === 0 && (
                <p className="text-xs text-amber-600">No active locations yet. Go to Locations and create one first.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>College Name <span className="text-destructive">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Vishnu Institute of Technology"
              />
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, City, State"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="principal@vishnu.edu.in"
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!isValid}>Create College</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
