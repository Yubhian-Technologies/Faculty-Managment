"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { staffDesignationLabel } from "@/components/supportingStaff/SupportingStaffSelfProfile";
import { useOwnSupportingStaff } from "@/hooks/useOwnSupportingStaff";
import { supportingStaffCategoryLabel } from "@/lib/supportingStaff/roleCategory";
import { PHONE_REGEX, EMAIL_REGEX, APAAR_REGEX } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { SupportingStaffMember } from "@/types";

interface IdentityForm {
  legalName: string;
  apaarFacultyId: string;
  highestQualification: string;
  email: string;
  mobileNo: string;
}

// Self-service Identity & Employment editor for a Supporting Staff member's own "My Profile" - the counterpart of
// panel/profile/edit (Faculty). Everything the managing role controls (Employee ID, College Email - their login -,
// Department, Designation, Staff Category, Date of Joining) is shown read-only for context and never sent; the
// server (PATCH /api/college/supporting-staff/me) would not accept it either.
export default function EditMyStaffProfileIdentityPage() {
  const { staff, loading, message } = useOwnSupportingStaff();

  if (loading) return <PageHeader title="Edit Identity & Employment" description="Loading…" />;

  if (!staff) {
    return (
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/college-staff/profile"><ArrowLeft className="h-4 w-4 mr-1" />Back to My Profile</Link>
        </Button>
        <PageHeader title="Edit Identity & Employment" description={message ?? "No staff record was found for your login."} />
      </div>
    );
  }

  return <IdentityEditForm staff={staff} />;
}

function IdentityEditForm({ staff }: { staff: Partial<SupportingStaffMember> }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<IdentityForm>(() => ({
    legalName: staff.legalName ?? "",
    apaarFacultyId: staff.apaarFacultyId ?? "",
    highestQualification: staff.highestQualification ?? "",
    email: staff.email ?? "",
    mobileNo: staff.mobileNo ?? "",
  }));
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>(() => staff.additionalPhoneNumbers ?? []);
  // The mobile number as stored: a number that was already there (maybe not 10 digits) never blocks an unrelated save.
  const storedMobile = staff.mobileNo ?? "";

  function set(patch: Partial<IdentityForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.legalName.trim()) {
      toast({ variant: "destructive", title: "Full Name (as per SSC) is required" });
      return;
    }
    if (!form.highestQualification.trim()) {
      toast({ variant: "destructive", title: "Highest Qualification is required" });
      return;
    }
    if (!form.mobileNo.trim()) {
      toast({ variant: "destructive", title: "Mobile No is required" });
      return;
    }
    if (form.mobileNo.trim() !== storedMobile.trim() && !PHONE_REGEX.test(form.mobileNo.trim())) {
      toast({ variant: "destructive", title: "Mobile No must be exactly 10 digits, starting with 6, 7, 8 or 9" });
      return;
    }
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) {
      toast({ variant: "destructive", title: "Enter a valid email address" });
      return;
    }
    if (form.apaarFacultyId.trim() && !APAAR_REGEX.test(form.apaarFacultyId.trim())) {
      toast({ variant: "destructive", title: "APAAR Faculty ID must be exactly 12 digits" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/college/supporting-staff/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: form.legalName.trim().toUpperCase(),
          apaarFacultyId: form.apaarFacultyId.trim(),
          highestQualification: form.highestQualification.trim(),
          email: form.email.trim(),
          mobileNo: form.mobileNo.trim(),
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save changes");
      }
      toast({ variant: "success", title: "Profile updated" });
      router.push("/college-staff/profile");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <Link href="/college-staff/profile">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to My Profile
        </Link>
      </Button>
      <PageHeader title="Edit Identity & Employment" description={`Employee ID: ${staff.employeeId ?? ""}`} />

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Identity & Employment</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground -mt-2">
              Employee ID, College Email, Department, Designation, Staff Category and Date of Joining are set by your HOD / College Office and can&apos;t be changed here.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={staff.employeeId ?? ""} disabled />
              </div>
              <div className="space-y-2">
                <Label>College Email</Label>
                <Input value={staff.collegeEmail ?? ""} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Full Name (as per SSC) *</Label>
              <Input
                value={form.legalName}
                onChange={(e) => set({ legalName: e.target.value.toUpperCase() })}
                placeholder="FULL NAME IN CAPITALS"
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>APAAR Faculty ID</Label>
              <Input
                inputMode="numeric" maxLength={12}
                value={form.apaarFacultyId}
                onChange={(e) => set({ apaarFacultyId: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                placeholder="123456789012"
              />
              {!!form.apaarFacultyId && !APAAR_REGEX.test(form.apaarFacultyId) && (
                <p className="text-xs text-destructive">Must be exactly 12 digits</p>
              )}
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Role Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={staff.department || "Centrally managed"} disabled />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={staffDesignationLabel(staff) ?? "-"} disabled />
              </div>
              <div className="space-y-2">
                <Label>Staff Category</Label>
                <Input value={staff.staffCategory ? supportingStaffCategoryLabel(staff.staffCategory) : "-"} disabled />
              </div>
              <div className="space-y-2">
                <Label>Highest Qualification *</Label>
                <Input value={form.highestQualification} onChange={(e) => set({ highestQualification: e.target.value })} placeholder="e.g. Diploma, B.Com, ITI" />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date of Joining</Label>
                <Input value={staff.joiningDate ? formatDate(staff.joiningDate) : "-"} disabled />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="staff@example.com" />
                {!!form.email.trim() && !EMAIL_REGEX.test(form.email.trim()) && (
                  <p className="text-xs text-destructive">Doesn&rsquo;t look like a valid email address</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Mobile No *</Label>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setExtraPhones((p) => [...p, { label: "", number: "" }])}
                  >
                    + Add Number
                  </Button>
                </div>
                <Input
                  type="tel" inputMode="numeric" autoComplete="off"
                  value={form.mobileNo}
                  onChange={(e) => set({ mobileNo: e.target.value })}
                  placeholder="9876543210"
                />
                {!!form.mobileNo.trim() && form.mobileNo.trim() !== storedMobile.trim() && !PHONE_REGEX.test(form.mobileNo.trim()) && (
                  <p className="text-xs text-destructive">Must be exactly 10 digits, starting with 6, 7, 8 or 9</p>
                )}
              </div>
            </div>

            {extraPhones.length > 0 && (
              <div className="space-y-3">
                {extraPhones.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <TextInput
                        label="Label (optional)"
                        value={item.label}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, label: v } : p)))}
                        placeholder="e.g. Personal, WhatsApp, or a name"
                      />
                      <TextInput
                        label="Mobile Number"
                        type="tel"
                        value={item.number}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, number: v } : p)))}
                        placeholder="9876543210"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-7"
                      onClick={() => setExtraPhones((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end mt-6 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => router.push("/college-staff/profile")}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
