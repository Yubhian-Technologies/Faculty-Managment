"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, Lock } from "lucide-react";
import type { EmployeeLeaveProfile, LeaveEmploymentType, StaffCategory } from "@/types/leave";

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

const INITIAL: ProfileForm = {
  employmentType: "",
  staffCategory: "",
  isTeachingStaff: false,
  gender: "",
  maritalStatus: "",
  dateOfJoining: "",
  isConfirmed: false,
  livingChildrenCount: 0,
};

// Fields HR already set on the faculty record — pre-filled from there and
// locked so the faculty can't redefine them during self-service setup.
type LockedField = "employmentType" | "gender" | "maritalStatus" | "dateOfJoining";

// Firestore Timestamps cross the API as plain JSON (`{ _seconds, _nanoseconds }`),
// not class instances — so `.toDate()` isn't available on the client.
function timestampToDateInput(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate().toISOString().split("T")[0];
  const secs = v._seconds ?? v.seconds;
  return typeof secs === "number" ? new Date(secs * 1000).toISOString().split("T")[0] : "";
}

export default function LeaveProfileSetupPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>(INITIAL);
  const [locked, setLocked] = useState<Partial<Record<LockedField, boolean>>>({});
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/leave/profile")
      .then((r) => r.json() as Promise<{ profile: EmployeeLeaveProfile | null; facultyDefaults: Partial<EmployeeLeaveProfile> | null }>)
      .then((d) => {
        if (d.profile) {
          // Already set up — nothing to pre-fill here; the faculty page redirects away.
          return;
        }
        const fd = d.facultyDefaults;
        if (!fd) return;
        const nextLocked: Partial<Record<LockedField, boolean>> = {};
        setForm((prev) => {
          const next = { ...prev };
          if (fd.employmentType) { next.employmentType = fd.employmentType; nextLocked.employmentType = true; }
          if (fd.gender) { next.gender = fd.gender; nextLocked.gender = true; }
          if (fd.maritalStatus) { next.maritalStatus = fd.maritalStatus; nextLocked.maritalStatus = true; }
          if (fd.dateOfJoining) {
            const iso = timestampToDateInput(fd.dateOfJoining);
            if (iso) { next.dateOfJoining = iso; nextLocked.dateOfJoining = true; }
          }
          return next;
        });
        setLocked(nextLocked);
      })
      .catch(() => { /* non-fatal — faculty can still fill the form manually */ })
      .finally(() => setLoadingDefaults(false));
  }, []);

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isValid =
    !!form.employmentType &&
    !!form.staffCategory &&
    !!form.gender &&
    !!form.maritalStatus &&
    !!form.dateOfJoining;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentType: form.employmentType,
          staffCategory: form.staffCategory,
          isTeachingStaff: form.isTeachingStaff,
          gender: form.gender,
          maritalStatus: form.maritalStatus,
          dateOfJoining: form.dateOfJoining,
          isConfirmed: form.isConfirmed,
          livingChildrenCount: form.livingChildrenCount,
        }),
      });
      const json = await res.json() as { profile?: unknown; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Setup failed" });
        return;
      }
      toast({ variant: "success", title: "Leave profile set up", description: "Your leave balances will be initialized shortly." });
      router.push("/panel/leave");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Button variant="ghost" size="sm" onClick={() => router.push("/panel/leave")} className="-ml-1 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Leave
      </Button>

      <PageHeader
        title="Set Up Leave Profile"
        description="This information is used to calculate your leave entitlements and eligibility."
      />

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Employment Type *
                  {locked.employmentType && <Lock className="h-3 w-3 text-muted-foreground" />}
                </Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) => set("employmentType", v as LeaveEmploymentType)}
                  disabled={locked.employmentType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingDefaults ? "Loading…" : "Select type"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="probation">Probation</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                  </SelectContent>
                </Select>
                {locked.employmentType && (
                  <p className="text-xs text-muted-foreground">Set by HR and can&apos;t be changed here.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Staff Category *</Label>
                <Select
                  value={form.staffCategory}
                  onValueChange={(v) => set("staffCategory", v as StaffCategory)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation Staff</SelectItem>
                    <SelectItem value="non-vacation">Non-Vacation Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Date of Joining *
                {locked.dateOfJoining && <Lock className="h-3 w-3 text-muted-foreground" />}
              </Label>
              <Input
                type="date"
                value={form.dateOfJoining}
                onChange={(e) => set("dateOfJoining", e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                disabled={locked.dateOfJoining}
              />
              {locked.dateOfJoining && (
                <p className="text-xs text-muted-foreground">Set by HR and can&apos;t be changed here.</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isTeachingStaff}
                  onChange={(e) => set("isTeachingStaff", e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm">Teaching staff</span>
              </label>
              {form.employmentType === "permanent" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isConfirmed}
                    onChange={(e) => set("isConfirmed", e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <span className="text-sm">Service confirmed</span>
                </label>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Gender *
                  {locked.gender && <Lock className="h-3 w-3 text-muted-foreground" />}
                </Label>
                <Select
                  value={form.gender}
                  onValueChange={(v) => set("gender", v as "male" | "female" | "other")}
                  disabled={locked.gender}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Marital Status *
                  {locked.maritalStatus && <Lock className="h-3 w-3 text-muted-foreground" />}
                </Label>
                <Select
                  value={form.maritalStatus}
                  onValueChange={(v) => set("maritalStatus", v as "married" | "unmarried")}
                  disabled={locked.maritalStatus}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="married">Married</SelectItem>
                    <SelectItem value="unmarried">Unmarried</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(locked.gender || locked.maritalStatus) && (
              <p className="text-xs text-muted-foreground -mt-2">Set by HR and can&apos;t be changed here.</p>
            )}

            <div className="space-y-2">
              <Label>Living children count</Label>
              <Select
                value={String(form.livingChildrenCount)}
                onValueChange={(v) => set("livingChildrenCount", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}{n === 4 ? "+" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Used to determine Maternity Leave eligibility.</p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.push("/panel/leave")} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid || submitting} loading={submitting}>
            Save & Initialize Balances
          </Button>
        </div>
      </form>
    </div>
  );
}
