"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { Users, CheckCircle, AlertCircle } from "lucide-react";
import type { EmployeeLeaveProfile, LeaveEmploymentType, StaffCategory } from "@/types/leave";

interface FacultyRow {
  uid: string;
  name?: string;
  department?: string;
  email?: string;
  staffType?: "teaching" | "supporting";
}

interface ProfilesData {
  faculty: FacultyRow[];
  profiles: EmployeeLeaveProfile[];
  withoutProfiles: FacultyRow[];
}

interface ProfileForm {
  employmentType: LeaveEmploymentType | "";
  staffCategory: StaffCategory | "";
  isTeachingStaff: boolean;
  gender: "male" | "female" | "other" | "";
  maritalStatus: "married" | "unmarried" | "";
  dateOfJoining: string;
  isConfirmed: boolean;
  livingChildrenCount: number;
}

const EMPTY_FORM: ProfileForm = {
  employmentType: "", staffCategory: "", isTeachingStaff: false,
  gender: "", maritalStatus: "", dateOfJoining: "", isConfirmed: false, livingChildrenCount: 0,
};

export default function HODLeaveProfilesPage() {
  const [data, setData] = useState<ProfilesData | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFaculty, setSelectedFaculty] = useState<FacultyRow | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leave/profiles");
      if (res.ok) {
        const d = await res.json() as ProfilesData;
        setData(d);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load faculty profiles" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function setField<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openSetup(faculty: FacultyRow) {
    const existing = data?.profiles.find((p) => p.uid === faculty.uid);
    if (existing) {
      setForm({
        employmentType: (existing.employmentType as LeaveEmploymentType) ?? "",
        staffCategory: (existing.staffCategory as StaffCategory) ?? "",
        isTeachingStaff: existing.isTeachingStaff ?? false,
        gender: (existing.gender as "male" | "female" | "other") ?? "",
        maritalStatus: (existing.maritalStatus as "married" | "unmarried") ?? "",
        dateOfJoining: typeof existing.dateOfJoining === "string"
          ? existing.dateOfJoining
          : (existing.dateOfJoining as unknown as { toDate?: () => Date })?.toDate?.()?.toISOString().split("T")[0] ?? "",
        isConfirmed: existing.isConfirmed ?? false,
        livingChildrenCount: existing.livingChildrenCount ?? 0,
      });
    } else {
      // Auto-fill based on staffType stored at user creation
      const isTeaching = faculty.staffType === "teaching";
      setForm({
        ...EMPTY_FORM,
        isTeachingStaff: isTeaching,
        staffCategory: isTeaching ? "vacation" : "non-vacation",
      });
    }
    setSelectedFaculty(faculty);
    setDialogOpen(true);
  }

  const handleSave = async () => {
    if (!selectedFaculty) return;
    const isValid = !!form.employmentType && !!form.staffCategory && !!form.gender && !!form.maritalStatus && !!form.dateOfJoining;
    if (!isValid) { toast({ variant: "destructive", title: "Please fill all required fields" }); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/profile?uid=${encodeURIComponent(selectedFaculty.uid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to save" }); return; }
      toast({ variant: "success", title: `Profile saved for ${selectedFaculty.name ?? selectedFaculty.uid}` });
      setDialogOpen(false);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const profileByUid = new Map(data?.profiles.map((p) => [p.uid, p]) ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Leave Profiles"
        description="Set up leave profiles for faculty in your department"
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}
        </div>
      ) : !data || data.faculty.length === 0 ? (
        <EmptyState title="No faculty found" description="No faculty members are in your department." icon={<Users className="h-8 w-8" />} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Faculty ({data.faculty.length})
              {data.withoutProfiles.length > 0 && (
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                  {data.withoutProfiles.length} not set up
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {data.faculty.map((f) => {
                const hasProfile = profileByUid.has(f.uid);
                const profile = profileByUid.get(f.uid);
                return (
                  <div key={f.uid} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {hasProfile ? (
                          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        )}
                        <p className="text-sm font-medium truncate">{f.name ?? f.uid}</p>
                        {f.staffType && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            f.staffType === "teaching"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                            {f.staffType === "teaching" ? "Teaching" : "Supporting"}
                          </span>
                        )}
                      </div>
                      {hasProfile && profile ? (
                        <p className="text-xs text-muted-foreground ml-6 capitalize">
                          {profile.employmentType} · {profile.staffCategory} · {profile.isTeachingStaff ? "Teaching" : "Non-teaching"}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-600 ml-6">Leave profile not set up</p>
                      )}
                    </div>
                    <Button size="sm" variant={hasProfile ? "outline" : "default"} onClick={() => openSetup(f)}>
                      {hasProfile ? "Edit" : "Setup"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Leave Profile — {selectedFaculty?.name ?? selectedFaculty?.uid}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select value={form.employmentType} onValueChange={(v) => setField("employmentType", v as LeaveEmploymentType)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="probation">Probation</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Staff Category *</Label>
                <Select value={form.staffCategory} onValueChange={(v) => setField("staffCategory", v as StaffCategory)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation Staff</SelectItem>
                    <SelectItem value="non-vacation">Non-Vacation Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gender *</Label>
                <Select value={form.gender} onValueChange={(v) => setField("gender", v as "male" | "female" | "other")}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Marital Status *</Label>
                <Select value={form.maritalStatus} onValueChange={(v) => setField("maritalStatus", v as "married" | "unmarried")}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="married">Married</SelectItem>
                    <SelectItem value="unmarried">Unmarried</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Date of Joining *</Label>
              <Input type="date" value={form.dateOfJoining} onChange={(e) => setField("dateOfJoining", e.target.value)} max={new Date().toISOString().split("T")[0]} />
            </div>

            <div className="space-y-2">
              <Label>Living children count</Label>
              <Select value={String(form.livingChildrenCount)} onValueChange={(v) => setField("livingChildrenCount", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}{n === 4 ? "+" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isTeachingStaff} onChange={(e) => setField("isTeachingStaff", e.target.checked)} className="h-4 w-4 rounded" />
                <span className="text-sm">Teaching staff</span>
              </label>
              {form.employmentType === "permanent" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isConfirmed} onChange={(e) => setField("isConfirmed", e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-sm">Service confirmed</span>
                </label>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={saving}>Save Profile</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
