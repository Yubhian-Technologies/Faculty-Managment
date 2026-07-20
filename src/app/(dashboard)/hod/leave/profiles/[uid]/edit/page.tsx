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

export default function HODLeaveProfileEditPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [faculty, setFaculty] = useState<FacultyRow | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);

  useEffect(() => {
    fetch("/api/leave/profiles")
      .then((r) => r.json() as Promise<ProfilesData>)
      .then((data) => {
        const f = data.faculty.find((x) => x.uid === uid);
        if (!f) {
          toast({ variant: "destructive", title: "Faculty not found" });
          router.push("/hod/leave/profiles");
          return;
        }
        setFaculty(f);
        const existing = data.profiles.find((p) => p.uid === uid);
        if (existing) {
          setHasProfile(true);
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
          const isTeaching = f.staffType === "teaching";
          setForm({
            ...EMPTY_FORM,
            isTeachingStaff: isTeaching,
            staffCategory: isTeaching ? "vacation" : "non-vacation",
          });
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty profile" }))
      .finally(() => setLoading(false));
  }, [uid, router]);

  function setField<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isValid = !!form.employmentType && !!form.staffCategory && !!form.gender && !!form.maritalStatus && !!form.dateOfJoining;
    if (!isValid) { toast({ variant: "destructive", title: "Please fill all required fields" }); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/leave/profile?uid=${encodeURIComponent(uid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to save" }); return; }
      toast({ variant: "success", title: `Profile saved for ${faculty?.name ?? uid}` });
      router.push("/hod/leave/profiles");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Leave Profile" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title={`Leave Profile — ${faculty?.name ?? uid}`}
        description={hasProfile ? "Edit this faculty member's leave profile" : "Set up a leave profile for this faculty member"}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
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

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Profile</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
