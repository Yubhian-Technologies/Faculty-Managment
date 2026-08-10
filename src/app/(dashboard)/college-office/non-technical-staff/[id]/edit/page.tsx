"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { SupportingStaffProfileFields } from "@/components/supportingStaff/SupportingStaffProfileFields";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import { EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type {
  EmploymentType, FacultyStatus, SupportingStaffDesignation,
  SupportingStaffProfileFields as ProfileFieldsType, Department, Religion, Caste,
} from "@/types";

interface StaffForm {
  name: string;
  phone: string;
  collegeEmail: string;
  designation: SupportingStaffDesignation;
  otherDesignationTitle: string;
  department: string;
  experienceYears: number;
  employmentType: EmploymentType;
  status: FacultyStatus;
  joiningDate: string;
}

const EMPTY_FORM: StaffForm = {
  name: "", phone: "", collegeEmail: "", designation: "", otherDesignationTitle: "",
  department: "", experienceYears: 0, employmentType: "PERMANENT", status: "ACTIVE", joiningDate: "",
};

export default function EditNonTechnicalStaffPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const staffId = params.id;
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<Partial<ProfileFieldsType>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* department assignment is optional */ });
  }, []);

  useEffect(() => {
    fetch(`/api/college/supporting-staff/${staffId}`)
      .then((r) => r.json() as Promise<{ staff?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.staff) {
          toast({ variant: "destructive", title: "Staff record not found" });
          router.push("/college-office/non-technical-staff");
          return;
        }
        const m = data.staff;
        setEmployeeId((m.employeeId as string) ?? "");
        setEmail((m.email as string) ?? "");
        setForm({
          name: (m.name as string) ?? "",
          phone: (m.phone as string) ?? "",
          collegeEmail: (m.collegeEmail as string) ?? "",
          designation: (m.designation as SupportingStaffDesignation) ?? "",
          otherDesignationTitle: (m.otherDesignationTitle as string) ?? "",
          department: (m.department as string) ?? "",
          experienceYears: (m.experienceYears as number) ?? 0,
          employmentType: (m.employmentType as EmploymentType) ?? "PERMANENT",
          status: (m.status as FacultyStatus) ?? "ACTIVE",
          joiningDate: toDateInputValue(m.joiningDate as never),
        });
        setPersonalDetails({
          gender: (m.gender as string) ?? "",
          dateOfBirth: toDateInputValue(m.dateOfBirth as never),
          legalName: (m.legalName as string) ?? "",
          fatherName: (m.fatherName as string) ?? "",
          motherName: (m.motherName as string) ?? "",
          religion: m.religion as Religion | undefined,
          caste: m.caste as Caste | undefined,
          subCaste: (m.subCaste as string) ?? "",
          aadharNo: (m.aadharNo as string) ?? "",
          panNo: (m.panNo as string) ?? "",
          passportNumber: (m.passportNumber as string) ?? "",
          emergencyContactName: (m.emergencyContactName as string) ?? "",
          emergencyContactPhone: (m.emergencyContactPhone as string) ?? "",
          ratificationStatus: (m.ratificationStatus as string) ?? "",
          ratificationDate: toDateInputValue(m.ratificationDate as never),
          maritalStatus: (m.maritalStatus as string) ?? "",
          spouseName: (m.spouseName as string) ?? "",
          numberOfChildren: m.numberOfChildren as number | undefined,
          referral: (m.referral as string) ?? "",
          nativePlace: (m.nativePlace as string) ?? "",
          temporaryAddress: (m.temporaryAddress as string) ?? "",
          permanentSameAsTemporary: (m.permanentSameAsTemporary as boolean) ?? false,
          permanentAddress: (m.permanentAddress as string) ?? "",
          bloodGroup: (m.bloodGroup as string) ?? "",
        });
        setProfile((m.supportingStaffProfile as Partial<ProfileFieldsType>) ?? {});
        setPhotoUrl((m.profilePhotoUrl as string) || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router]);

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
    setSaving(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email,
          employeeId,
          ...personalDetails,
          supportingStaffProfile: profile,
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
      router.push("/college-office/non-technical-staff");
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Edit Non-Technical Staff" description="Loading…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Edit Non-Technical Staff" description={`Employee ID: ${employeeId} · ${email}`} />

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Left column */}
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Staff Details</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
                  <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                    <Label>Profile Photo</Label>
                    <AvatarUploadField name={form.name || "?"} photoUrl={photoUrl} targetId={staffId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
                  </div>
                  <div className="grid flex-1 grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label>Employee ID *</Label>
                      <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
                    </div>
                    <div className="space-y-2">
                      <Label>Full Name *</Label>
                      <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>College Email *</Label>
                    <Input type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@vishnu.edu.in" />
                    <p className="text-xs text-muted-foreground">This is their login username.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Personal Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
                  </div>
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Role</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Designation *</Label>
                    <Select value={form.designation} onValueChange={(v) => set({ designation: v as SupportingStaffDesignation })}>
                      <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent><DesignationOptions collegeType={collegeType} kind="supporting" /></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select value={form.department || "__none__"} onValueChange={(v) => set({ department: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Centrally managed" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Centrally managed (no department)</SelectItem>
                        {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.designation === "OTHER" && (
                  <div className="space-y-2">
                    <Label>Designation Title</Label>
                    <Input value={form.otherDesignationTitle} onChange={(e) => set({ otherDesignationTitle: e.target.value })} placeholder="e.g. Store Keeper" />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Years of Experience</Label>
                    <Input type="number" min={0} value={form.experienceYears} onChange={(e) => set({ experienceYears: e.target.value === "" ? 0 : Number(e.target.value) })} />
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
                    <Label>Employment Type *</Label>
                    <Select value={form.employmentType} onValueChange={(v) => set({ employmentType: v as EmploymentType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Joining Date *</Label>
                    <Input type="date" value={form.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
              <CardContent>
                <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
              <CardContent>
                <SupportingStaffProfileFields value={profile} onChange={setProfile} collegeType={collegeType} />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end mt-6 pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
