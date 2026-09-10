"use client";

import { useEffect, useMemo, useState } from "react";
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
import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { PersonalDetailsFields, getMissingRequiredPersonalFields, FACULTY_REQUIRED_PERSONAL_FIELDS, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import {
  QualificationFields, ExperienceFields, ResearchFields, GrantsFields,
  MentorshipFields, FinancialFields, OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import { RepeatingGroup, TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import { totalPreviousExperienceYears, formatExperienceDuration } from "@/lib/faculty/experienceCalc";
import { PHONE_REGEX } from "@/lib/validations";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";
import { FACULTY_DESIGNATIONS, FACULTY_EMPLOYMENT_CATEGORIES, designationLabel } from "@/lib/designations/config";
import { useCollegeType } from "@/hooks/useCollegeType";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields } from "@/types";

// Sentinel for the "Others" row - never stored, it just switches the field to
// free text (Radix Select cannot hold an empty-string item value).
const OTHER_QUALIFICATION = "__OTHER__";

// collegeEmail/password are validated for FORMAT here but not required at the
// zod level - they're only actually required when creating a brand new login
// (the default flow). When completing a Sub-HOD's profile for an ALREADY
// existing login (see `linkUid` below), those two fields don't apply at all
// - that required-ness is instead checked manually in onSubmit, since it
// depends on which mode the page is in.
const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  apaarFacultyId: z.string().optional(),
  // Optional - Full Name (as per SSC), captured via `personalDetails` below,
  // is the primary/required identity name now; this is only kept for
  // statutory/financial paperwork matching.
  name: z.string().min(2, "Name must be at least 2 characters").optional().or(z.literal("")),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
  phone: z.string().min(1, "Mobile No is required").regex(PHONE_REGEX, "Doesn't look like a valid phone number"),
  designation: z.string().min(1, "Designation is required"),
  qualification: z.string().min(1, "Qualification is required"),
  specialization: z.string().optional(),
  experienceYears: z.number().min(0, "Cannot be negative").optional(),
  joiningDate: z.string().min(1, "Date of Joining is required"),
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
  const user = useAuthStore((s) => s.user);
  // Same derivation as the bulk-import page (hod/faculty/import/page.tsx) -
  // an HOD can now head more than one top-level department at once
  // (user.departments), so which one a NEW faculty member belongs to is no
  // longer implicit. POST /api/college/faculty rejects with no way to
  // recover from the UI otherwise (it 400s "You manage more than one
  // department - specify which" once departments.length > 1) - this picker
  // is what actually satisfies that requirement.
  const myDepartments = user?.departments && user.departments.length > 0 ? user.departments : (user?.department ? [user.department] : []);

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

  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  // Pre-fills Full Name (as per SSC) from the existing HOD login's name in
  // link mode - same starting point `defaultValues.name` below used to give,
  // now that legalName (not name) is the primary identity field. Editable
  // either way; the login's real name for their own SSC certificate may
  // differ from what's on file for the login itself.
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>(
    () => (linkName ? { legalName: linkName } : {})
  );
  const [department, setDepartment] = useState("");
  // Whichever department this new faculty member actually ends up filed
  // under, however it was decided - link mode's fixed department, this HOD's
  // own explicit pick (multi-department HOD), or their own single department
  // implicitly. Passed to TeachingAssignmentsEditor so its Year options are
  // scoped to THIS department's own Course Year Timings.
  const effectiveDepartment = isLinkMode ? linkDepartment : (department || myDepartments[0] || "");
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  // Extra contact numbers beyond the primary Mobile No below - each with an
  // optional freeform label (e.g. "Personal", or just whoever's number it
  // is), not a fixed category.
  const [extraPhones, setExtraPhones] = useState<{ label?: string; number: string }[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      experienceYears: 0, designation: "", employmentType: "Regular", password: "", aicteEligible: false,
      ...(isLinkMode ? { name: linkName } : {}),
    },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

  const designation = watch("designation");
  const employmentType = watch("employmentType");
  const isOtherDesignation = !!designation && !FACULTY_DESIGNATIONS.includes(designation);
  const isOtherEmploymentType = !!employmentType && !FACULTY_EMPLOYMENT_CATEGORIES.includes(employmentType);
  const qualification = watch("qualification");
  // "Others" is a mode, not a stored value - it reveals a free-text box whose
  // contents become `qualification`. Needs its own state because once the user
  // types "MBA" the field no longer matches any option, which is
  // indistinguishable from a pre-filled value that simply isn't on the list.
  const [qualIsOther, setQualIsOther] = useState(false);
  const aicteEligible = watch("aicteEligible");
  const name = watch("name");

  // Total Years of Experience is calculated from Previous Experience's
  // From/To dates (see experienceCalc.ts), not typed manually - kept in sync
  // with the form's own experienceYears field so submit sends the computed
  // total as-is (the "core" step's input just displays it, read-only).
  const totalExperience = useMemo(
    () => totalPreviousExperienceYears(academicProfile.previousInstitutions),
    [academicProfile.previousInstitutions]
  );
  useEffect(() => {
    setValue("experienceYears", totalExperience);
  }, [totalExperience, setValue]);

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
    employeeId: "Employee ID", name: "Name (as per PAN)", collegeEmail: "College Email",
    password: "Login Password", phone: "Mobile No", designation: "Designation",
    qualification: "Highest Qualification", experienceYears: "Total Years of Experience",
    joiningDate: "Date of Joining", employmentType: "Employee Category",
    legalName: "Full Name (as per SSC)",
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
    // Which department this faculty member belongs to isn't in the zod
    // schema (link mode ignores it entirely - the department is already
    // fixed to linkDepartment) - checked here instead, same pattern as
    // College Email/Password below. Only actually required once this HOD
    // heads more than one department; a single-department HOD never sees
    // the picker and the server falls back to their one department itself.
    if (!isLinkMode && myDepartments.length > 1 && !department) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: "Identity & Employment: Department" });
      return;
    }
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
    // Full Name (as per SSC) lives in `personalDetails` state but is rendered
    // on the "core" step (right after Employee ID, matching the template's
    // own field order) - not zod-validated, so it's checked here, same
    // pattern as College Email/Password above, and routes back to "core"
    // (not "personal", where the input no longer visually is).
    if (!personalDetails.legalName?.trim()) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: "Identity & Employment: Full Name (as per SSC)" });
      return;
    }
    // Personal Details isn't zod-validated (PersonalDetailsFields is plain
    // React state) - checked here instead, same pattern as the College
    // Email/Password check above, since these fields are now mandatory too.
    const missingPersonal = getMissingRequiredPersonalFields(personalDetails, FACULTY_REQUIRED_PERSONAL_FIELDS);
    if (missingPersonal.length > 0) {
      setErroredSteps(new Set<WizardStepKey>(["personal"]));
      setStepIndex(steps.findIndex((s) => s.key === "personal"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: `Personal Details: ${missingPersonal.join(", ")}` });
      return;
    }
    // Full Name (as per SSC) is the primary display name - used everywhere
    // this faculty member's name is shown (see facultyDisplayName()) -
    // falling back to Name (as per PAN) only if legalName is somehow blank.
    const displayName = personalDetails.legalName?.trim() || data.name?.trim() || "";
    setSubmitting(true);
    try {
      const res = await fetch(isLinkMode ? "/api/college/faculty/link-hod" : "/api/college/faculty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
          ...(isLinkMode
            ? { linkUid, department: linkDepartment, collegeEmail: undefined, password: undefined }
            : department ? { department } : {}),
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
        const errors = await syncTeachingAssignments(json.id, displayName, [], teachingRows);
        if (errors.length > 0) {
          toast({ variant: "destructive", title: "Some teaching assignments failed to save", description: errors.join("; ") });
        }
      }

      toast({
        variant: "success",
        title: isLinkMode ? "Profile completed" : "Faculty member added",
        description: isLinkMode
          ? `${displayName}'s faculty profile is now complete.`
          : `${displayName} has been added to the register.`,
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
                    <AvatarUploadField name={personalDetails.legalName || name || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
                  </div>
                  <div className="grid flex-1 grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="employeeId">Employee ID *</Label>
                      <Input id="employeeId" {...register("employeeId")} placeholder="EMP-001" />
                      {errors.employeeId && <p className="text-sm text-destructive">{errors.employeeId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="legalName">Full Name (as per SSC) *</Label>
                      <Input
                        id="legalName"
                        value={personalDetails.legalName ?? ""}
                        onChange={(e) => setPersonalDetails((p) => ({ ...p, legalName: e.target.value.toUpperCase() }))}
                        placeholder="FULL NAME IN CAPITALS"
                        className="uppercase"
                      />
                      <p className="text-xs text-muted-foreground">Enter the name exactly as it appears on the SSC (10th class) certificate - this is the faculty member&apos;s primary display name across the app.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Name (as per PAN)</Label>
                      <Input id="name" {...register("name")} placeholder="Dr. Priya Nair" />
                      {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                      <p className="text-xs text-muted-foreground">Optional - only needed for statutory/financial paperwork matching.</p>
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

                {/* Only shown when this HOD heads more than one department at
                    once - a single-department HOD's own department is always
                    implicit, same as before. Placed right after identity,
                    before Role/Employment Details, since it decides which
                    department's register this faculty member is filed under -
                    the same slot the read-only version above shows for a
                    Sub-HOD link. */}
                {!isLinkMode && myDepartments.length > 1 && (
                  <div className="space-y-2">
                    <Label>Department *</Label>
                    <Select value={department} onValueChange={setDepartment}>
                      <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">You manage more than one department - choose which one this faculty member belongs to.</p>
                  </div>
                )}

                {!isLinkMode && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="collegeEmail">College Email *</Label>
                      <Input id="collegeEmail" type="email" {...register("collegeEmail")} placeholder="name@vishnu.edu.in" />
                      {errors.collegeEmail && <p className="text-sm text-destructive">{errors.collegeEmail.message}</p>}
                      <p className="text-xs text-muted-foreground">This is used as their login username.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Login Password *</Label>
                      <Input id="password" type="password" {...register("password")} placeholder="Min 8 characters" />
                      {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
                      <p className="text-xs text-muted-foreground">
                        Share this with the faculty member so they can log in with their college email as a Panel Member.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Personal Email</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="faculty@example.com" />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Mobile No *</Label>
                    <Input id="phone" type="tel" autoComplete="off" {...register("phone")} placeholder="+91 98765 43210" />
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
                  </div>
                </div>

                <RepeatingGroup
                  title="Additional Mobile Numbers"
                  items={extraPhones}
                  empty={{ label: "", number: "" }}
                  onChange={setExtraPhones}
                  addLabel="Add Number"
                  renderRow={(item, update) => (
                    <>
                      <TextInput
                        label="Label (optional)"
                        value={item.label}
                        onChange={(v) => update({ label: v })}
                        placeholder="e.g. Personal, WhatsApp, or a name"
                      />
                      <TextInput label="Mobile Number" value={item.number} onChange={(v) => update({ number: v })} placeholder="+91 98765 43210" />
                    </>
                  )}
                />

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Role Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Designation *</Label>
                    <Select
                      value={isOtherDesignation ? "OTHER" : designation}
                      onValueChange={(v) => setValue("designation", v === "OTHER" ? "OTHER" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent>
                        {FACULTY_DESIGNATIONS.map((d) => <SelectItem key={d} value={d}>{designationLabel(d)}</SelectItem>)}
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {isOtherDesignation && (
                      <Input
                        value={designation === "OTHER" ? "" : designation}
                        onChange={(e) => setValue("designation", e.target.value || "OTHER")}
                        placeholder="Please specify"
                      />
                    )}
                    {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Highest Qualification *</Label>
                    <Select
                      value={qualIsOther ? OTHER_QUALIFICATION : (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(qualification) ? qualification : ""}
                      onValueChange={(v) => {
                        const other = v === OTHER_QUALIFICATION;
                        setQualIsOther(other);
                        // Picking "Others" clears the field so the text box
                        // below starts empty and its value lands in this same
                        // `qualification` string - there's no separate "other"
                        // column on FacultyMember, and the whole app (import,
                        // export, resume PDF, profile views) reads just this one.
                        setValue("qualification", other ? "" : v);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                      <SelectContent>
                        {HIGHEST_QUALIFICATION_OPTIONS.map((q) => (
                          <SelectItem key={q} value={q}>{q}</SelectItem>
                        ))}
                        <SelectItem value={OTHER_QUALIFICATION}>Others</SelectItem>
                      </SelectContent>
                    </Select>
                    {qualIsOther && (
                      <Input {...register("qualification")} placeholder="e.g. MBA, M.Phil, M.A" />
                    )}
                    {errors.qualification && <p className="text-sm text-destructive">{errors.qualification.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="specialization">Specialization</Label>
                    <Input id="specialization" {...register("specialization")} placeholder="e.g. Machine Learning, VLSI" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="experienceYears">Total Years of Experience</Label>
                    <Input id="experienceYears" value={formatExperienceDuration(totalExperience) || "0 mos"} readOnly disabled className="bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Calculated automatically from the From/To dates added under Professional Experience.
                    </p>
                  </div>
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Employee Category *</Label>
                    <Select
                      value={isOtherEmploymentType ? "OTHER" : employmentType}
                      onValueChange={(v) => setValue("employmentType", v === "OTHER" ? "OTHER" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {FACULTY_EMPLOYMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {isOtherEmploymentType && (
                      <Input
                        value={employmentType === "OTHER" ? "" : employmentType}
                        onChange={(e) => setValue("employmentType", e.target.value || "OTHER")}
                        placeholder="Please specify"
                      />
                    )}
                    {errors.employmentType && <p className="text-sm text-destructive">{errors.employmentType.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="joiningDate">Date of Joining *</Label>
                    <Input id="joiningDate" type="date" {...register("joiningDate")} />
                    {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
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

            {step.key === "personal" && (
              <PersonalDetailsFields
                value={personalDetails}
                onChange={setPersonalDetails}
                requiredFields={FACULTY_REQUIRED_PERSONAL_FIELDS}
                hiddenFields={["legalName", "esiNumber"]}
              />
            )}
            {step.key === "qualification" && <QualificationFields value={academicProfile} onChange={setAcademicProfile} collegeType={collegeType} />}
            {step.key === "experience" && <ExperienceFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "research" && <ResearchFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "grants" && <GrantsFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "mentorship" && <MentorshipFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "financial" && <FinancialFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "others" && <OthersFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "teaching-load" && (
              <TeachingAssignmentsEditor value={teachingRows} onChange={setTeachingRows} department={effectiveDepartment} />
            )}
            {step.key === "review" && (
              <p className="text-sm text-muted-foreground">
                {isLinkMode
                  ? <>Review the steps above using Back, then submit to complete <strong>{personalDetails.legalName || name || "this Sub-HOD"}</strong>&apos;s faculty profile.</>
                  : <>Review the steps above using Back, then submit to create <strong>{personalDetails.legalName || name || "this faculty member"}</strong>&apos;s account and record.</>}
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
