"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ArrowLeft } from "lucide-react";
import type { LeaveEmploymentType, StaffCategory } from "@/types/leave";

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

export default function HODLeaveProfileSetupPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>({
    employmentType: "", staffCategory: "", isTeachingStaff: false,
    gender: "", maritalStatus: "", dateOfJoining: "", isConfirmed: false, livingChildrenCount: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isValid = !!form.employmentType && !!form.staffCategory && !!form.gender && !!form.maritalStatus && !!form.dateOfJoining;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Setup failed" }); return; }
      toast({ variant: "success", title: "Leave profile set up", description: "Your leave balances will be initialized shortly." });
      router.push("/hod/leave");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Button variant="ghost" size="sm" onClick={() => router.push("/hod/leave")} className="-ml-1 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" />Back to My Leave
      </Button>

      <PageHeader title="Set Up Leave Profile" description="Used to calculate your leave entitlements and eligibility." />

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card>
          <CardHeader><CardTitle className="text-base">Employment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select value={form.employmentType} onValueChange={(v) => set("employmentType", v as LeaveEmploymentType)}>
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
                <Select value={form.staffCategory} onValueChange={(v) => set("staffCategory", v as StaffCategory)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation Staff</SelectItem>
                    <SelectItem value="non-vacation">Non-Vacation Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date of Joining *</Label>
              <Input type="date" value={form.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} max={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isTeachingStaff} onChange={(e) => set("isTeachingStaff", e.target.checked)} className="h-4 w-4 rounded" />
                <span className="text-sm">Teaching staff</span>
              </label>
              {form.employmentType === "permanent" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isConfirmed} onChange={(e) => set("isConfirmed", e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-sm">Service confirmed</span>
                </label>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gender *</Label>
                <Select value={form.gender} onValueChange={(v) => set("gender", v as "male" | "female" | "other")}>
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
                <Select value={form.maritalStatus} onValueChange={(v) => set("maritalStatus", v as "married" | "unmarried")}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="married">Married</SelectItem>
                    <SelectItem value="unmarried">Unmarried</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Living children count</Label>
              <Select value={String(form.livingChildrenCount)} onValueChange={(v) => set("livingChildrenCount", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}{n === 4 ? "+" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Used to determine Maternity Leave eligibility.</p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.push("/hod/leave")} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={!isValid || submitting} loading={submitting}>Save & Initialize Balances</Button>
        </div>
      </form>
    </div>
  );
}
