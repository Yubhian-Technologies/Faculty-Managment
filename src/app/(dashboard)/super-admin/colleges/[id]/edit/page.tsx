"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LocateFixed } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PolygonMapPicker, type LatLng } from "@/components/shared/PolygonMapPicker";
import { toast } from "@/hooks/useToast";
import { COLLEGE_TYPE_LABELS } from "@/types";
import type { CollegeType, College } from "@/types";

const COLLEGE_TYPES: CollegeType[] = ["ENGINEERING", "SCHOOL", "DENTAL", "PHARMACY", "POLYTECHNIC", "DEGREE"];

type CollegeRow = {
  id: string;
  name: string;
  type?: CollegeType;
  address: string;
  contactEmail: string;
  contactPhone: string;
  campusLocation?: College["campusLocation"];
  [key: string]: unknown;
};

type GeofenceShape = "none" | "circle" | "polygon";

export default function EditCollegePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const collegeId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [shape, setShape] = useState<GeofenceShape>("none");
  const [polygonPoints, setPolygonPoints] = useState<LatLng[]>([]);
  const [form, setForm] = useState<{
    name: string; type: CollegeType | ""; address: string; contactEmail: string; contactPhone: string;
    latitude: string; longitude: string; radiusMeters: string;
  }>({
    name: "", type: "", address: "", contactEmail: "", contactPhone: "",
    latitude: "", longitude: "", radiusMeters: "200",
  });

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
        const cl = college.campusLocation;
        setForm({
          name: college.name ?? "",
          type: college.type ?? "",
          address: college.address ?? "",
          contactEmail: college.contactEmail ?? "",
          contactPhone: college.contactPhone ?? "",
          latitude: cl?.shape === "circle" ? String(cl.latitude) : "",
          longitude: cl?.shape === "circle" ? String(cl.longitude) : "",
          radiusMeters: cl?.shape === "circle" ? String(cl.radiusMeters) : "200",
        });
        setShape(cl?.shape ?? "none");
        setPolygonPoints(cl?.shape === "polygon" ? cl.points : []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load college" }))
      .finally(() => setLoading(false));
  }, [collegeId, router]);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast({ variant: "destructive", title: "Geolocation is not supported by this browser" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) });
        setLocating(false);
      },
      () => {
        toast({ variant: "destructive", title: "Failed to get current location", description: "Check location permissions and try again" });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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

    let campusLocation: College["campusLocation"] | null = null;
    if (shape === "circle") {
      const latitude = Number(form.latitude);
      const longitude = Number(form.longitude);
      const radiusMeters = Number(form.radiusMeters);
      if (!form.latitude.trim() || !form.longitude.trim() || Number.isNaN(latitude) || Number.isNaN(longitude) || !radiusMeters || radiusMeters <= 0) {
        toast({ variant: "destructive", title: "Latitude, longitude and a positive radius are all required for a circle geofence" });
        return;
      }
      campusLocation = { shape: "circle", latitude, longitude, radiusMeters };
    } else if (shape === "polygon") {
      if (polygonPoints.length < 3) {
        toast({ variant: "destructive", title: "A boundary needs at least 3 points — click the map to add more" });
        return;
      }
      campusLocation = { shape: "polygon", points: polygonPoints };
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
          campusLocation,
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

            <div className="space-y-3 pt-2 border-t">
              <div className="pt-4">
                <Label className="text-sm font-medium">Campus Location (Attendance Geofence)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Faculty must be inside this boundary to mark self-attendance. Super Admin only.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-shape">Boundary Shape</Label>
                <Select value={shape} onValueChange={(v) => setShape(v as GeofenceShape)}>
                  <SelectTrigger id="edit-shape"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (no geofence check)</SelectItem>
                    <SelectItem value="circle">Circle (center point + radius)</SelectItem>
                    <SelectItem value="polygon">Polygon (draw the real boundary on a map)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {shape === "circle" && (
                <>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={useCurrentLocation} loading={locating}>
                      <LocateFixed className="h-3.5 w-3.5 mr-1.5" /> Use Current Location
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="edit-lat">Latitude</Label>
                      <Input
                        id="edit-lat"
                        type="number"
                        step="any"
                        value={form.latitude}
                        onChange={(e) => set({ latitude: e.target.value })}
                        placeholder="17.3850"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-lng">Longitude</Label>
                      <Input
                        id="edit-lng"
                        type="number"
                        step="any"
                        value={form.longitude}
                        onChange={(e) => set({ longitude: e.target.value })}
                        placeholder="78.4867"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-radius">Radius (meters)</Label>
                      <Input
                        id="edit-radius"
                        type="number"
                        min="1"
                        value={form.radiusMeters}
                        onChange={(e) => set({ radiusMeters: e.target.value })}
                        placeholder="200"
                      />
                    </div>
                  </div>
                </>
              )}

              {shape === "polygon" && (
                <PolygonMapPicker
                  points={polygonPoints}
                  onChange={setPolygonPoints}
                  initialCenter={
                    polygonPoints[0]
                      ?? (form.latitude && form.longitude ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : undefined)
                  }
                />
              )}
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
