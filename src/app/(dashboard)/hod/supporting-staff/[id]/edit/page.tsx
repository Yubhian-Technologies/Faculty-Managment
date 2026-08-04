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
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { SupportingStaffProfileFields } from "@/components/supportingStaff/SupportingStaffProfileFields";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import {
  EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS,
  TECHNICAL_STAFF_DESIGNATION_LABELS, NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
} from "@/types";
import type {
  EmploymentType, FacultyStatus, SupportingStaffCategory, SupportingStaffDesignation,
  SupportingStaffProfileFields as ProfileFieldsType,
} from "@/types";

interface StaffForm {
  name: string;
  phone: string;
  collegeEmail: string;
  staffCategory: SupportingStaffCategory;
  designation: SupportingStaffDesignation;
  otherDesignationTitle: string;
  experienceYears: number;
  employmentType: EmploymentType;
  status: FacultyStatus;
  joiningDate: string;
}

const EMPTY_FORM: StaffForm = {
  name: "", phone: "", collegeEmail: "", staffCategory: "TECHNICAL", designation: "LAB_ASSISTANT",
  otherDesignationTitle: "", experienceYears: 0, employmentType: "PERMANENT", status: "ACTIVE", joiningDate: "",
};

export default function EditSupportingStaffPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const staffId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<Partial<ProfileFieldsType>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [joiningLetterUrl, setJoiningLetterUrl] = useState<string>("");
  const [appointmentLetterUrl, setAppointmentLetterUrl] = useState<string>("");

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
        setForm({
          name: (m.name as string) ?? "",
          phone: (m.phone as string) ?? "",
          collegeEmail: (m.collegeEmail as string) ?? "",
          staffCategory: (m.staffCategory as SupportingStaffCategory) ?? "TECHNICAL",
          designation: (m.designation as SupportingStaffDesignation) ?? "LAB_ASSISTANT",
          otherDesignationTitle: (m.otherDesignationTitle as string) ?? "",
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
          religion: (m.religion as string) ?? "",
          caste: (m.caste as string) ?? "",
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
        setJoiningLetterUrl((m.joiningLetterUrl as string) ?? "");
        setAppointmentLetterUrl((m.appointmentLetterUrl as string) ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff record" }))
      .finally(() => setLoading(false));
  }, [staffId, router]);

  function set(patch: Partial<StaffForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  const designationLabels = form.staffCategory === "TECHNICAL" ? TECHNICAL_STAFF_DESIGNATION_LABELS : NON_TECHNICAL_STAFF_DESIGNATION_LABELS;

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
          joiningLetterUrl,
          appointmentLetterUrl,
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
    <div>
      <PageHeader title="Edit Supporting Staff" description={`Employee ID: ${employeeId} · ${email}`} />

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
                    <Label>Staff Category *</Label>
                    <Select value={form.staffCategory} onValueChange={(v) => set({ staffCategory: v as SupportingStaffCategory, designation: v === "TECHNICAL" ? "LAB_ASSISTANT" : "OFFICE_STAFF" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TECHNICAL">Technical Staff</SelectItem>
                        <SelectItem value="NON_TECHNICAL">Non-Technical Staff</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Designation *</Label>
                    <Select value={form.designation} onValueChange={(v) => set({ designation: v as SupportingStaffDesignation })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(designationLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
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

            <Card>
              <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">Upload signed copies of the joining letter and appointment order for this staff member.</p>
                <DocumentUploadField
                  label="Joining Letter"
                  value={joiningLetterUrl || undefined}
                  uploadEndpoint="/api/upload/supporting-staff-document"
                  extraFields={{ staffId, docType: "joining-letter" }}
                  onUploaded={(url) => setJoiningLetterUrl(url)}
                  onRemoved={() => setJoiningLetterUrl("")}
                />
                <DocumentUploadField
                  label="Appointment Letter"
                  value={appointmentLetterUrl || undefined}
                  uploadEndpoint="/api/upload/supporting-staff-document"
                  extraFields={{ staffId, docType: "appointment-letter" }}
                  onUploaded={(url) => setAppointmentLetterUrl(url)}
                  onRemoved={() => setAppointmentLetterUrl("")}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
              <CardContent>
                <SupportingStaffProfileFields value={profile} onChange={setProfile} staffCategory={form.staffCategory} />
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
