"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import {
  QualificationFields, ExperienceFields, ResearchFields, GrantsFields,
  MentorshipFields, FinancialFields, OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import { PHONE_REGEX } from "@/lib/validations";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { EMPLOYMENT_TYPE_LABELS } from "@/types";
import type { FacultyProfileFields } from "@/types";

const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  apaarFacultyId: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().min(1, "College email is required").email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().regex(PHONE_REGEX, "Doesn't look like a valid phone number").optional().or(z.literal("")),
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

type WizardStepKey =
  | "core" | "personal" | "qualification" | "experience" | "research" | "grants"
  | "mentorship" | "financial" | "others" | "teaching-load" | "review";

interface WizardStep {
  key: WizardStepKey;
  label: string;
}

export default function NewFacultyPage() {
  const router = useRouter();
  const { collegeType } = useCollegeType();
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { experienceYears: 0, designation: "", employmentType: "PERMANENT", password: "", aicteEligible: false },
  });

  const designation = watch("designation");
  const employmentType = watch("employmentType");
  const aicteEligible = watch("aicteEligible");
  const name = watch("name");

  const steps: WizardStep[] = useMemo(() => [
    { key: "core", label: "Identity & Employment" },
    { key: "personal", label: PROFILE_MODULES.personal.label },
    { key: "qualification", label: PROFILE_MODULES.qualification.label },
    { key: "experience", label: PROFILE_MODULES.experience.label },
    { key: "research", label: PROFILE_MODULES.research.label },
    { key: "grants", label: PROFILE_MODULES.grants.label },
    { key: "mentorship", label: PROFILE_MODULES.mentorship.label },
    { key: "financial", label: PROFILE_MODULES.financial.label },
    { key: "teaching-load", label: PROFILE_MODULES["teaching-load"].label },
    { key: "others", label: PROFILE_MODULES.others.label },
    { key: "review", label: "Review & Submit" },
  ], []);

  const step = steps[stepIndex];

  async function goNext() {
    if (step.key === "core") {
      const valid = await trigger();
      if (!valid) return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/college/faculty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          academicProfile,
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add Faculty Member" description="Add a new entry to your department's faculty register" />

      {/* Step indicator */}
      <div className="flex flex-wrap gap-2 mb-4">
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              i === stepIndex ? "bg-primary text-primary-foreground" : i < stepIndex ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {i < stepIndex && <Check className="h-3 w-3" />}
            {s.label}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardHeader><CardTitle className="text-base">{step.label}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {step.key === "core" && (
              <>
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
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
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

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Role Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Designation *</Label>
                    <Select value={designation} onValueChange={(v) => setValue("designation", v)}>
                      <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent><DesignationOptions collegeType={collegeType} kind="teaching" /></SelectContent>
                    </Select>
                    {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qualification">Highest Qualification *</Label>
                    <Input id="qualification" {...register("qualification")} placeholder="e.g. Ph.D, M.Tech, M.Sc" />
                    {errors.qualification && <p className="text-sm text-destructive">{errors.qualification.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="specialization">Specialization</Label>
                    <Input id="specialization" {...register("specialization")} placeholder="e.g. Machine Learning, VLSI" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="experienceYears">Years of Experience *</Label>
                    <Input id="experienceYears" type="number" min={0} {...register("experienceYears", { valueAsNumber: true })} />
                    {errors.experienceYears && <p className="text-sm text-destructive">{errors.experienceYears.message}</p>}
                  </div>
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Employment Type *</Label>
                    <Select value={employmentType} onValueChange={(v) => setValue("employmentType", v)}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.employmentType && <p className="text-sm text-destructive">{errors.employmentType.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="joiningDate">Date of Joining Institution *</Label>
                    <Input id="joiningDate" type="date" {...register("joiningDate")} />
                    {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dateOfJoiningDepartment">Date of Joining Department</Label>
                    <Input id="dateOfJoiningDepartment" type="date" {...register("dateOfJoiningDepartment")} />
                    <p className="text-xs text-muted-foreground">Leave blank if same as institution joining date.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox" id="aicteEligible" checked={aicteEligible ?? false}
                    onChange={(e) => setValue("aicteEligible", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="aicteEligible" className="cursor-pointer">AICTE Eligible</Label>
                </div>
              </>
            )}

            {step.key === "personal" && <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />}
            {step.key === "qualification" && <QualificationFields value={academicProfile} onChange={setAcademicProfile} collegeType={collegeType} />}
            {step.key === "experience" && <ExperienceFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "research" && <ResearchFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "grants" && <GrantsFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "mentorship" && <MentorshipFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "financial" && <FinancialFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "others" && <OthersFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "teaching-load" && <TeachingAssignmentsEditor value={teachingRows} onChange={setTeachingRows} />}
            {step.key === "review" && (
              <p className="text-sm text-muted-foreground">
                Review the steps above using Back, then submit to create <strong>{name || "this faculty member"}</strong>&apos;s account and record.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between pt-6">
          <Button type="button" variant="outline" onClick={() => (stepIndex === 0 ? router.back() : goBack())}>
            <ChevronLeft className="h-4 w-4 mr-2" />{stepIndex === 0 ? "Cancel" : "Back"}
          </Button>
          {step.key === "review" ? (
            <Button type="submit" loading={submitting}>Add to Register</Button>
          ) : (
            <Button type="button" onClick={goNext}>Next<ChevronRight className="h-4 w-4 ml-2" /></Button>
          )}
        </div>
      </form>
    </div>
  );
}
