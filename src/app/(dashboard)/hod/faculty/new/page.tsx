"use client";

import { useState } from "react";
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
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { TechnicalStaffProfileFields } from "@/components/faculty/TechnicalStaffProfileFields";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { toast } from "@/hooks/useToast";
import {
  EMPLOYMENT_TYPE_LABELS,
  TECHNICAL_STAFF_DESIGNATIONS,
} from "@/types";
import type { Designation, FacultyProfileFields, TechnicalProfile } from "@/types";

const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  apaarFacultyId: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().min(1, "College email is required").email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  designation: z.string().min(1, "Designation is required"),
  qualification: z.string().min(1, "Qualification is required"),
  specialization: z.string().optional(),
  experienceYears: z.number().min(0, "Cannot be negative"),
  joiningDate: z.string().min(1, "Joining date is required"),
  dateOfJoiningDepartment: z.string().optional(),
  employmentType: z.string().min(1, "Employment type is required"),
  aicteEligible: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

export default function NewFacultyPage() {
  const router = useRouter();
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [technicalProfile, setTechnicalProfile] = useState<Partial<TechnicalProfile>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { experienceYears: 0, designation: "ASSISTANT_PROFESSOR", employmentType: "PERMANENT", password: "", aicteEligible: false },
  });

  const designation = watch("designation");
  const employmentType = watch("employmentType");
  const aicteEligible = watch("aicteEligible");
  const name = watch("name");
  const isTechnical = TECHNICAL_STAFF_DESIGNATIONS.includes(designation as Designation);

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch("/api/college/faculty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(isTechnical ? { technicalProfile } : { academicProfile }),
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
        toast({ variant: "destructive", title: "Failed to add faculty", description: json.error });
        return;
      }

      if (json.id && teachingRows.length > 0) {
        const errors = await syncTeachingAssignments(json.id, data.name, [], teachingRows);
        if (errors.length > 0) {
          toast({ variant: "destructive", title: "Some teaching assignments failed to save", description: errors.join("; ") });
        }
      }

      toast({ variant: "success", title: "Faculty member added", description: `${data.name} has been added to the register.` });
      router.push("/hod/faculty");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add Faculty Member"
        description="Add a new entry to your department's faculty register"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Faculty Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Identity */}
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
                  <Input id="name" {...register("name")} placeholder="Dr. Priya Nair" />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apaarFacultyId">APAAR Faculty ID</Label>
                  <Input id="apaarFacultyId" {...register("apaarFacultyId")} placeholder="NBA/AICTE APAAR ID" />
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
                <Input id="email" type="email" {...register("email")} placeholder="faculty@example.com" />
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
              <p className="text-xs text-muted-foreground">
                Share this with the faculty member so they can log in with their college email as a Panel Member.
              </p>
            </div>

            {/* Role details */}
            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Role Details</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select
                  value={designation}
                  onValueChange={(v) => setValue("designation", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select designation" />
                  </SelectTrigger>
                  <SelectContent>
                    <DesignationOptions />
                  </SelectContent>
                </Select>
                {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="qualification">Highest Qualification *</Label>
                <Input
                  id="qualification"
                  {...register("qualification")}
                  placeholder="e.g. Ph.D, M.Tech, M.Sc"
                />
                {errors.qualification && <p className="text-sm text-destructive">{errors.qualification.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="specialization">Specialization</Label>
                <Input
                  id="specialization"
                  {...register("specialization")}
                  placeholder="e.g. Machine Learning, VLSI"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="experienceYears">Years of Experience *</Label>
                <Input
                  id="experienceYears"
                  type="number"
                  min={0}
                  {...register("experienceYears", { valueAsNumber: true })}
                />
                {errors.experienceYears && <p className="text-sm text-destructive">{errors.experienceYears.message}</p>}
              </div>
            </div>

            {/* Employment */}
            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => setValue("employmentType", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.employmentType && <p className="text-sm text-destructive">{errors.employmentType.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="joiningDate">Date of Joining Institution *</Label>
                <Input
                  id="joiningDate"
                  type="date"
                  {...register("joiningDate")}
                />
                {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateOfJoiningDepartment">Date of Joining Department</Label>
                <Input
                  id="dateOfJoiningDepartment"
                  type="date"
                  {...register("dateOfJoiningDepartment")}
                />
                <p className="text-xs text-muted-foreground">Leave blank if same as institution joining date.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="aicteEligible"
                checked={aicteEligible ?? false}
                onChange={(e) => setValue("aicteEligible", e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="aicteEligible" className="cursor-pointer">AICTE Eligible</Label>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Add to Register
              </Button>
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

      {isTechnical ? (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Technical Profile</CardTitle></CardHeader>
          <CardContent>
            <TechnicalStaffProfileFields value={technicalProfile} onChange={setTechnicalProfile} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
            <CardContent>
              <AcademicProfileFields value={academicProfile} onChange={setAcademicProfile} includeTeachingAssignment />
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Current Teaching Assignments</CardTitle></CardHeader>
            <CardContent>
              <TeachingAssignmentsEditor value={teachingRows} onChange={setTeachingRows} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
