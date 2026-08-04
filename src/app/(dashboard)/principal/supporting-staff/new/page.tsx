"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { SupportingStaffProfileFields } from "@/components/supportingStaff/SupportingStaffProfileFields";
import { toast } from "@/hooks/useToast";
import {
  EMPLOYMENT_TYPE_LABELS,
  STAFF_CATEGORY_LABELS,
  TECHNICAL_STAFF_DESIGNATION_LABELS,
  NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
} from "@/types";
import type { Department, EmploymentType, SupportingStaffCategory, SupportingStaffProfileFields as ProfileFieldsType } from "@/types";

const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().min(1, "College email is required").email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  staffCategory: z.enum(["TECHNICAL", "NON_TECHNICAL"]),
  designation: z.string().min(1, "Designation is required"),
  otherDesignationTitle: z.string().optional(),
  department: z.string().optional(),
  experienceYears: z.number().min(0, "Cannot be negative"),
  joiningDate: z.string().min(1, "Joining date is required"),
  employmentType: z.string().min(1, "Employment type is required"),
});

type FormData = z.infer<typeof schema>;

export default function NewSupportingStaffPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Partial<ProfileFieldsType>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { experienceYears: 0, staffCategory: "TECHNICAL", designation: "LAB_ASSISTANT", employmentType: "PERMANENT", password: "", department: "" },
  });

  const staffCategory = watch("staffCategory") as SupportingStaffCategory;
  const designation = watch("designation");
  const employmentType = watch("employmentType");
  const department = watch("department");
  const name = watch("name");

  const designationLabels = staffCategory === "TECHNICAL" ? TECHNICAL_STAFF_DESIGNATION_LABELS : NON_TECHNICAL_STAFF_DESIGNATION_LABELS;

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch("/api/college/supporting-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          supportingStaffProfile: profile,
          ...personalDetails,
          ...(photoUrl ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      const json = await res.json() as { id?: string; error?: string };

      if (res.status === 409) {
        toast({ variant: "destructive", title: "Already exists", description: json.error });
        return;
      }
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add staff member", description: json.error });
        return;
      }

      toast({ variant: "success", title: "Supporting staff added", description: `${data.name} has been added.` });
      router.push("/principal/supporting-staff");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add Supporting Staff"
        description="Add a Technical or Non-Technical staff member to the college"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employeeId">Employee ID *</Label>
                  <Input id="employeeId" {...register("employeeId")} placeholder="EMP-001" />
                  {errors.employeeId && <p className="text-sm text-destructive">{errors.employeeId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" {...register("name")} placeholder="Ramesh Kumar" />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="collegeEmail">College Email *</Label>
                <Input id="collegeEmail" type="email" {...register("collegeEmail")} placeholder="name@vishnu.edu.in" />
                {errors.collegeEmail && <p className="text-sm text-destructive">{errors.collegeEmail.message}</p>}
                <p className="text-xs text-muted-foreground">This is used as their login username.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Personal Email</Label>
                <Input id="email" type="email" {...register("email")} placeholder="staff@example.com" />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...register("phone")} placeholder="+91 98765 43210" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Login Password *</Label>
              <Input id="password" type="password" {...register("password")} placeholder="Min 8 characters" />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              <p className="text-xs text-muted-foreground">Share this with the staff member so they can log in with their college email.</p>
            </div>

            {/* Staff Category */}
            <div className="space-y-2">
              <Label>Staff Category *</Label>
              <div className="flex gap-3">
                {(["TECHNICAL", "NON_TECHNICAL"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setValue("staffCategory", c, { shouldValidate: true });
                      setValue("designation", c === "TECHNICAL" ? "LAB_ASSISTANT" : "OFFICE_STAFF");
                    }}
                    className={`flex-1 rounded-lg border-2 py-3 text-sm font-medium transition-all ${
                      staffCategory === c
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted bg-background text-muted-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    {STAFF_CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
              {errors.staffCategory && <p className="text-sm text-destructive">{errors.staffCategory.message}</p>}
              <p className="text-xs text-muted-foreground">
                {staffCategory === "TECHNICAL"
                  ? "Lab Assistant, Programmer, System Administrator, Network Engineer."
                  : "Office Staff, Accountant, Librarian, Clerk, Attender, Office Assistant."}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={designation} onValueChange={(v) => setValue("designation", v)}>
                  <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(designationLabels).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
              </div>
              {designation === "OTHER" && (
                <div className="space-y-2">
                  <Label htmlFor="otherDesignationTitle">Designation Title</Label>
                  <Input id="otherDesignationTitle" {...register("otherDesignationTitle")} placeholder="e.g. Store Keeper" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="experienceYears">Years of Experience *</Label>
                <Input id="experienceYears" type="number" min={0} {...register("experienceYears", { valueAsNumber: true })} />
                {errors.experienceYears && <p className="text-sm text-destructive">{errors.experienceYears.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={department || "none"} onValueChange={(v) => setValue("department", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Not assigned (centrally managed)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not assigned —</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional — leave unassigned for centrally-managed roles (Librarian, Accountant, etc.).
              </p>
            </div>

            {/* Employment */}
            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select value={employmentType} onValueChange={(v) => setValue("employmentType", v as EmploymentType)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.employmentType && <p className="text-sm text-destructive">{errors.employmentType.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="joiningDate">Joining Date *</Label>
                <Input id="joiningDate" type="date" {...register("joiningDate")} />
                {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add Staff Member</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
        <CardContent>
          <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent>
          <SupportingStaffProfileFields value={profile} onChange={setProfile} staffCategory={staffCategory} />
        </CardContent>
      </Card>
    </div>
  );
}
