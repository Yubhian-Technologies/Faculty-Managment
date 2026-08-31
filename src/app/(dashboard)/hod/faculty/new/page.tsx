"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

// collegeEmail/password are validated for FORMAT here but not required at the
// zod level - they're only actually required when creating a brand new login
// (the default flow). When completing a Sub-HOD's profile for an ALREADY
// existing login (see `linkUid` below), those two fields don't apply at all
// - that required-ness is instead checked manually in onSubmit, since it
// depends on which mode the page is in.
const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  apaarFacultyId: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
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
  const searchParams = useSearchParams();
  const { collegeType } = useCollegeType();
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Reached from the Faculty Register's "Sub-Department HODs" card when that
  // sub-department's HOD login has no facultyMembers record yet (see
  // hod/faculty/page.tsx) - completes their profile onto their EXISTING
  // login instead of the default flow's "create a brand new one" (which
  // would either fail on their already-registered email, or worse, silently
  // create a second, disconnected account for the same person).
  const linkUid = searchParams.get("linkUid") ?? "";
  const linkDepartment = searchParams.get("department") ?? "";
  const linkName = searchParams.get("name") ?? "";
  const isLinkMode = !!(linkUid && linkDepartment);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      experienceYears: 0, designation: "", employmentType: "PERMANENT", password: "", aicteEligible: false,
      ...(isLinkMode ? { name: linkName } : {}),
    },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

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

  // Every validated/required field lives on the "core" step; map each to a
  // friendly label so a failed submit can say exactly what's missing and in
  // which module (see onInvalid). Steps can be navigated freely - validation
  // is deferred entirely to submit time.
  const FIELD_LABELS: Record<string, string> = {
    employeeId: "Employee ID", name: "Full Name", collegeEmail: "College Email",
    password: "Login Password", phone: "Phone", designation: "Designation",
    qualification: "Highest Qualification", experienceYears: "Total Years of Experience",
    joiningDate: "Date of Joining Institution", employmentType: "Employment Type",
  };

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function onInvalid(errs: typeof errors) {
    // All required fields are on the "core" (Identity & Employment) step, so
    // flag that module, jump to it, and list exactly which fields are missing.
    setErroredSteps(new Set<WizardStepKey>(["core"]));
    setStepIndex(steps.findIndex((s) => s.key === "core"));
    const missing = Object.keys(errs).map((f) => FIELD_LABELS[f] ?? f).join(", ");
    toast({ variant: "destructive", title: "Some required fields are missing", description: `Identity & Employment: ${missing}` });
  }

  const onSubmit = async (data: FormData) => {
    // College Email/Password aren't in the zod schema's required set (they
    // don't apply in link mode, see isLinkMode above) - so the default
    // "create a new login" flow enforces their presence here instead.
    if (!isLinkMode && (!data.collegeEmail?.trim() || !data.password?.trim())) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      const missing = [!data.collegeEmail?.trim() && "College Email", !data.password?.trim() && "Login Password"].filter(Boolean).join(", ");
      toast({ variant: "destructive", title: "Some required fields are missing", description: `Identity & Employment: ${missing}` });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(isLinkMode ? "/api/college/faculty/link-hod" : "/api/college/faculty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(isLinkMode ? { linkUid, department: linkDepartment, collegeEmail: undefined, password: undefined } : {}),
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
        toast({ variant: "destructive", title: isLinkMode ? "Failed to complete profile" : "Failed to add faculty", description: json.error });
        return;
      }

      if (json.id && teachingRows.length > 0) {
        const errors = await syncTeachingAssignments(json.id, data.name, [], teachingRows);
        if (errors.length > 0) {
          toast({ variant: "destructive", title: "Some teaching assignments failed to save", description: errors.join("; ") });
        }
      }

      toast({
        variant: "success",
        title: isLinkMode ? "Profile completed" : "Faculty member added",
        description: isLinkMode
          ? `${data.name}'s faculty profile is now complete.`
          : `${data.name} has been added to the register.`,
      });
      router.push("/hod/faculty");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={isLinkMode ? "Complete Faculty Profile" : "Add Faculty Member"}
        description={isLinkMode
          ? `Add the employment & profile details for ${linkName || "this Sub-HOD"}, already registered as ${linkDepartment}'s HOD`
          : "Add a new entry to your department's faculty register"}
      />

      {/* Step indicator - click any step to jump to it; steps with missing
          required fields (after a submit attempt) are outlined in red. */}
      <div className="flex flex-wrap gap-2 mb-4">
        {steps.map((s, i) => (
          <button
            type="button"
            key={s.key}
            onClick={() => setStepIndex(i)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              erroredSteps.has(s.key) ? "ring-1 ring-destructive text-destructive bg-destructive/5" :
              i === stepIndex ? "bg-primary text-primary-foreground" : i < stepIndex ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {i < stepIndex && !erroredSteps.has(s.key) && <Check className="h-3 w-3" />}
            {s.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
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

                {isLinkMode && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Department: </span>
                    <span className="font-medium">{linkDepartment}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This profile links to {linkName || "their"} existing HOD login - no new account or password is created.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {!isLinkMode && (
                    <div className="space-y-2">
                      <Label htmlFor="collegeEmail">College Email *</Label>
                      <Input id="collegeEmail" type="email" {...register("collegeEmail")} placeholder="name@vishnu.edu.in" />
                      {errors.collegeEmail && <p className="text-sm text-destructive">{errors.collegeEmail.message}</p>}
                      <p className="text-xs text-muted-foreground">This is used as their login username.</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="email">Personal Email</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="faculty@example.com" />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" autoComplete="off" {...register("phone")} placeholder="+91 98765 43210" />
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
                  </div>
                </div>

                {!isLinkMode && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Login Password *</Label>
                    <Input id="password" type="password" {...register("password")} placeholder="Min 8 characters" />
                    {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
                    <p className="text-xs text-muted-foreground">
                      Share this with the faculty member so they can log in with their college email as a Panel Member.
                    </p>
                  </div>
                )}

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
                    <Label htmlFor="experienceYears">Total Years of Experience *</Label>
                    <Input id="experienceYears" type="number" min={0} placeholder="e.g. 10" {...register("experienceYears", { valueAsNumber: true })} />
                    <p className="text-xs text-muted-foreground">
                      Their whole career, including previous institutions - not just years served here.
                    </p>
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
                {isLinkMode
                  ? <>Review the steps above using Back, then submit to complete <strong>{name || "this Sub-HOD"}</strong>&apos;s faculty profile.</>
                  : <>Review the steps above using Back, then submit to create <strong>{name || "this faculty member"}</strong>&apos;s account and record.</>}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between pt-6">
          <Button type="button" variant="outline" onClick={() => (stepIndex === 0 ? router.back() : goBack())}>
            <ChevronLeft className="h-4 w-4 mr-2" />{stepIndex === 0 ? "Cancel" : "Back"}
          </Button>
          {step.key === "review" ? (
            <Button type="submit" loading={submitting}>{isLinkMode ? "Save Profile" : "Add to Register"}</Button>
          ) : (
            <Button type="button" onClick={goNext}>Next<ChevronRight className="h-4 w-4 ml-2" /></Button>
          )}
        </div>
      </form>
    </div>
  );
}
