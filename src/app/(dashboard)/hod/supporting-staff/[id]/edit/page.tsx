"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { APAAR_REGEX } from "@/lib/validations";
import { FACULTY_STATUS_LABELS } from "@/types";
import type { DesignationCatalogItem, FacultyStatus, SupportingStaffDesignation } from "@/types";

interface StaffForm {
  legalName: string;
  apaarFacultyId: string;
  mobileNo: string;
  collegeEmail: string;
  designation: SupportingStaffDesignation;
  otherDesignationTitle: string;
  highestQualification: string;
  status: FacultyStatus;
  joiningDate: string;
}

const EMPTY_FORM: StaffForm = {
  legalName: "", apaarFacultyId: "", mobileNo: "", collegeEmail: "", designation: "", otherDesignationTitle: "", highestQualification: "",
  status: "ACTIVE", joiningDate: "",
};

// Department isn't editable here - a Technical staff record stays owned by
// the department it was created in (server-enforced, see
// /api/college/supporting-staff/[id] PATCH's HOD scope check).
export default function EditHodSupportingStaffPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const staffId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.staff) {
          toast({ variant: "destructive", title: "Staff record not found" });
          router.push("/hod/supporting-staff");
          return;
        }
        const m = data.staff;
        setEmployeeId((m.employeeId as string) ?? "");
        setEmail((m.email as string) ?? "");
        setDepartment((m.department as string) ?? "");
        setForm({
          legalName: (m.legalName as string) ?? "",
          apaarFacultyId: (m.apaarFacultyId as string) ?? "",
          mobileNo: (m.mobileNo as string) ?? "",
          collegeEmail: (m.collegeEmail as string) ?? "",
          designation: (m.designation as SupportingStaffDesignation) ?? "",
          otherDesignationTitle: (m.otherDesignationTitle as string) ?? "",
          highestQualification: (m.highestQualification as string) ?? "",
          status: (m.status as FacultyStatus) ?? "ACTIVE",
          joiningDate: toDateInputValue(m.joiningDate as never),
        });
        setExtraPhones((m.additionalPhoneNumbers as { label?: string; number: string }[]) ?? []);
        setPhotoUrl((m.profilePhotoUrl as string) || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router]);

  const [designationOptions, setDesignationOptions] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations?category=TECHNICAL");
        const data = await res.json() as { items?: DesignationCatalogItem[] };
        setDesignationOptions((data.items ?? []).filter((d) => d.isActive).map((d) => d.name));
      } catch {
        // Non-fatal - the picker just stays empty until the admin's catalog loads.
      }
    })();
  }, []);

  function set(patch: Partial<StaffForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId.trim()) {
      toast({ variant: "destructive", title: "Employee ID is required" });
      return;
    }
    if (!form.collegeEmail.trim()) {
      toast({ variant: "destructive", title: "College email is required" });
      return;
    }
    if (!form.mobileNo.trim()) {
      toast({ variant: "destructive", title: "Mobile No is required" });
      return;
    }
    if (!form.highestQualification.trim()) {
      toast({ variant: "destructive", title: "Highest Qualification is required" });
      return;
    }
    if (!form.legalName.trim()) {
      toast({ variant: "destructive", title: "Full Name (as per SSC) is required" });
      return;
    }
    if (form.apaarFacultyId.trim() && !APAAR_REGEX.test(form.apaarFacultyId.trim())) {
      toast({ variant: "destructive", title: "APAAR Faculty ID must be exactly 12 digits" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email,
          employeeId,
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
          ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      if (res.status === 409) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Employee ID already exists" });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error();

      toast({ variant: "success", title: "Staff record updated" });
      router.push("/hod/supporting-staff");
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Edit Supporting Staff" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <Link href="/hod/supporting-staff">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Supporting Staff
        </Link>
      </Button>
      <PageHeader title="Edit Supporting Staff" description={`Employee ID: ${employeeId} · ${email}`} />

      <form onSubmit={handleSubmit}>
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Staff Details</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={form.legalName || "?"} photoUrl={photoUrl} targetId={staffId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Employee ID *</Label>
                  <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
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
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>College Email *</Label>
              <Input type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@example.com" />
              <p className="text-xs text-muted-foreground">This is their login username.</p>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Role</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={form.designation} onValueChange={(v) => set({ designation: v as SupportingStaffDesignation })}>
                  <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                  <SelectContent>
                    {designationOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department || "-"} disabled />
              </div>
            </div>
            {form.designation === "OTHER" && (
              <div className="space-y-2">
                <Label>Designation Title</Label>
                <Input value={form.otherDesignationTitle} onChange={(e) => set({ otherDesignationTitle: e.target.value })} placeholder="e.g. Lab Technician" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Highest Qualification *</Label>
                <Input value={form.highestQualification} onChange={(e) => set({ highestQualification: e.target.value })} placeholder="e.g. Diploma, B.Com, ITI" />
              </div>
              <div className="space-y-2">
                <Label>Status *</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v as FacultyStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FACULTY_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date of Joining *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
                <p className="text-xs text-muted-foreground">Total Years of Experience is calculated automatically from this date.</p>
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
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
                <Input value={form.mobileNo} onChange={(e) => set({ mobileNo: e.target.value })} placeholder="+91 98765 43210" />
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
                        value={item.number}
                        onChange={(v) => setExtraPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, number: v } : p)))}
                        placeholder="+91 98765 43210"
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
          <Button type="button" variant="outline" onClick={() => router.push("/hod/supporting-staff")}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
