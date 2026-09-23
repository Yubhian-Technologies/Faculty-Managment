"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, Check, Trash2 } from "lucide-react";
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
  QualificationFields, ExperienceFields, ResearchFields,
  MentorshipFields, FinancialFields, OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import { experienceBreakdown, totalYearsOfExperience, formatDuration, allPreviousExperienceEntries } from "@/lib/faculty/experienceCalc";
import { PHONE_REGEX, EMAIL_REGEX, APAAR_REGEX } from "@/lib/validations";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";
import { EMPLOYEE_CATEGORY_LABELS, FACULTY_STATUS_LABELS, SELECTABLE_FACULTY_STATUS_VALUES } from "@/types";
import type { DesignationCatalogItem, EmployeeCategory, FacultyStatus } from "@/types";
import { useCollegeType } from "@/hooks/useCollegeType";
import { designationLabel } from "@/lib/designations/config";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { facultyDepartmentOptions } from "@/lib/departments/facultyDepartmentOptions";
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
  apaarFacultyId: z.string().regex(APAAR_REGEX, "APAAR Faculty ID must be exactly 12 digits").optional().or(z.literal("")),
  email: z.string().regex(EMAIL_REGEX, "Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().regex(EMAIL_REGEX, "Invalid email address").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
  mobileNo: z.string().min(1, "Mobile No is required").regex(PHONE_REGEX, "Mobile No must be exactly 10 digits, starting with 6, 7, 8 or 9"),
  designation: z.string().min(1, "Designation is required"),
  employeeCategory: z.string().min(1, "Employee Category is required"),
  status: z.string().min(1, "Status is required"),
  highestQualification: z.string().min(1, "Highest Qualification is required"),
  specialization: z.string().optional(),
  totalYearsOfExperience: z.number().min(0, "Cannot be negative").optional(),
  joiningDate: z.string().min(1, "Date of Joining is required"),
  aicteFacultyId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type WizardStepKey =
  | "core" | "personal" | "qualification" | "experience" | "research"
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
  // The college's own admin-curated Faculty Designation Catalog (see
  // DesignationCatalogCard) - no hardcoded list, no "Other" free-text escape
  // hatch any more.
  const [designationOptions, setDesignationOptions] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations?category=FACULTY");
        const data = await res.json() as { items?: DesignationCatalogItem[] };
        setDesignationOptions((data.items ?? []).filter((d) => d.isActive).map((d) => d.name));
      } catch {
        // Non-fatal - the picker just stays empty until the admin's catalog loads.
      }
    })();
  }, []);
  // Same derivation as the bulk-import page (hod/faculty/import/page.tsx) -
  // an HOD can now head more than one top-level department at once
  // (user.departments), so which one a NEW faculty member belongs to is no
  // longer implicit. POST /api/college/faculty rejects with no way to
  // recover from the UI otherwise (it 400s "You manage more than one
  // department - specify which" once departments.length > 1) - this picker
  // is what actually satisfies that requirement.
  const ownDepartments = useMyDepartments();
  // The Principal / Vice Principal (incl. a College Admin) add faculty too -
  // it is how a new college gets its first teaching staff before any HOD
  // exists. They belong to no department, so they always pick one from the
  // college's active departments; an HOD keeps their own list.
  //
  // "Owns no department" is the test rather than a list of role names: a
  // College Admin reaches this page too, and their login does not always
  // carry the literal PRINCIPAL role (a multi-seat account working as
  // Principal keeps its own underlying role on the user doc). Matching on
  // role alone skipped this whole block for them - no department fetch, no
  // picker, and nothing to fall back on, so the new faculty member was filed
  // under an empty department. Anyone with a department of their own (every
  // HOD) is unaffected.
  const isCollegeLevel =
    user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL" || ownDepartments.length === 0;
  // Fetched for every HOD too now, not just college-level - see
  // facultyDepartmentOptions' own doc-comment on why ownDepartments alone
  // isn't enough to offer a parent HOD's sub-departments here.
  const [allDepartments, setAllDepartments] = useState<{ id: string; name: string; code: string; parentDepartmentId?: string; isActive?: boolean }[]>([]);
  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: { id: string; name: string; code: string; parentDepartmentId?: string; isActive?: boolean }[] }>)
      .then((d) => setAllDepartments((d.departments ?? []).filter((dep) => dep.isActive !== false)))
      .catch(() => { /* picker stays empty */ });
  }, []);
  const myDepartments = isCollegeLevel
    ? allDepartments.map((d) => d.name)
    : facultyDepartmentOptions(allDepartments, ownDepartments).map((d) => d.name);
  const listPath = isCollegeLevel ? "/principal/faculty" : "/hod/faculty";

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
  // link mode. Editable either way; the login's real name for their own SSC
  // certificate may differ from what's on file for the login itself. Name (as
  // per PAN) is never pre-filled - it's only ever entered from the PAN card.
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
  // Pre-fills the now-always-visible Department picker once there's exactly
  // one real choice, so a genuinely single-department HOD still sees it
  // filled in without an extra click - only a real choice (more than one
  // option) is left for them to actually make.
  useEffect(() => {
    if (!isLinkMode && !department && myDepartments.length === 1) setDepartment(myDepartments[0]);
  }, [isLinkMode, department, myDepartments]);
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
    trigger,
    getValues,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      totalYearsOfExperience: 0, designation: "", password: "", status: "ACTIVE",
    },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

  const designation = watch("designation");
  const employeeCategory = watch("employeeCategory");
  const status = watch("status");
  const highestQualification = watch("highestQualification");
  // "Others" is a mode, not a stored value - it reveals a free-text box whose
  // contents become `highestQualification`. Needs its own state because once the user
  // types "MBA" the field no longer matches any option, which is
  // indistinguishable from a pre-filled value that simply isn't on the list.
  const [qualIsOther, setQualIsOther] = useState(false);
  const joiningDateValue = watch("joiningDate");

  // FacultyMember.totalYearsOfExperience (Total Years of Experience = Internal
  // since Date of Joining + External from Academic/Industry/Research
  // Experience's From/To dates) is actually recomputed server-side on
  // submit (see POST /api/college/faculty), from the same academicProfile/
  // joiningDate this form sends - this mirrors that so the "core" step's
  // read-only preview below always matches what gets saved.
  const allExperienceEntries = useMemo(
    () => allPreviousExperienceEntries(academicProfile),
    // The 3 specific arrays read are the real deps; academicProfile itself is
    // a new object every render and would defeat the memoization if listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [academicProfile.academicExperience, academicProfile.industryExperience, academicProfile.researchExperience]
  );
  const totalExperience = useMemo(
    () => experienceBreakdown(allExperienceEntries, joiningDateValue).total,
    [allExperienceEntries, joiningDateValue]
  );
  useEffect(() => {
    setValue("totalYearsOfExperience", totalExperience);
  }, [totalExperience, setValue]);

  // The "core" step's read-only preview - live Total Years of Experience
  // (Internal + External), the same figure the profile will show once this
  // faculty member is added.
  const previewTotalExperience = useMemo(
    () => totalYearsOfExperience(allExperienceEntries, joiningDateValue),
    [allExperienceEntries, joiningDateValue]
  );

  const steps: WizardStep[] = useMemo(() => [
    { key: "core", label: "Identity & Employment" },
    { key: "personal", label: PROFILE_MODULES.personal.label },
    { key: "qualification", label: PROFILE_MODULES.qualification.label },
    { key: "experience", label: PROFILE_MODULES.experience.label },
    { key: "research", label: PROFILE_MODULES.research.label },
    { key: "mentorship", label: PROFILE_MODULES.mentorship.label },
    { key: "financial", label: PROFILE_MODULES.financial.label },
    { key: "teaching-load", label: PROFILE_MODULES["teaching-load"].label },
    { key: "others", label: PROFILE_MODULES.others.label },
    { key: "review", label: "Review & Submit" },
  ], []);

  const step = steps[stepIndex];

  // Every validated/required field lives on the "core" step; map each to a
  // friendly label so a failed submit can say exactly what's missing and in
  // which module (see onInvalid). Next enforces the current step before
  // advancing (findStepProblem); submit re-checks everything, since the step
  // indicator can still jump straight to Review.
  const FIELD_LABELS: Record<string, string> = {
    employeeId: "Employee ID", collegeEmail: "College Email",
    password: "Login Password", mobileNo: "Mobile No", designation: "Designation",
    employeeCategory: "Employee Category", status: "Status",
    highestQualification: "Highest Qualification", totalYearsOfExperience: "Total Years of Experience",
    joiningDate: "Date of Joining",
    legalName: "Full Name (as per SSC)",
  };

  // Every constraint the final submit enforces, grouped by the step whose
  // fields it reads. Leaving a step checks that step's own fields, so a
  // problem is raised where it can be fixed - rather than surfacing all at
  // once at the very end, several steps away from the input at fault.
  //
  // A rule spanning two steps belongs to the LATER of them: Date of Birth
  // (Personal Details) vs Date of Joining (Identity & Employment) can only be
  // compared once both have been passed through.
  function findStepProblem(key: WizardStepKey): { title: string; description: string } | null {
    if (key === "core") {
      // The zod schema covers this step alone, so its own messages are the
      // complete list - each already reads as a full sentence ("Employee ID
      // is required", "Mobile No must be exactly 10 digits, ...").
      const problems = schema.safeParse(getValues()).error?.issues.map((i) => i.message) ?? [];
      // Not in the schema (they don't apply in link mode) - same checks
      // onSubmit makes, just raised a step earlier.
      if (!isLinkMode && !department) problems.push("Department is required");
      if (!isLinkMode && !getValues("collegeEmail")?.trim()) problems.push("College Email is required");
      if (!isLinkMode && !getValues("password")?.trim()) problems.push("Login Password is required");
      if (!personalDetails.legalName?.trim()) problems.push("Full Name (as per SSC) is required");
      if (problems.length > 0) {
        return {
          title: "Identity & Employment is incomplete",
          description: Array.from(new Set(problems)).join(" · "),
        };
      }
      return null;
    }

    if (key === "personal") {
      const missing = getMissingRequiredPersonalFields(personalDetails, FACULTY_REQUIRED_PERSONAL_FIELDS);
      if (missing.length > 0) {
        return { title: "Personal Details is incomplete", description: `Required: ${missing.join(", ")}` };
      }
      const joiningDate = getValues("joiningDate");
      if (personalDetails.dateOfBirth && joiningDate && personalDetails.dateOfBirth >= joiningDate) {
        return {
          title: "Date of Birth must be before Date of Joining",
          description: "Check the Date of Birth on this step and the Date of Joining on Identity & Employment.",
        };
      }
      return null;
    }

    // The remaining steps carry no required fields - everything on them is
    // optional profile detail.
    return null;
  }

  function goNext() {
    const problem = findStepProblem(step.key);
    if (problem) {
      // trigger() in parallel so the offending inputs are marked inline too,
      // not just named in the toast.
      if (step.key === "core") void trigger();
      setErroredSteps((prev) => new Set(prev).add(step.key));
      toast({ variant: "destructive", title: problem.title, description: problem.description });
      return;
    }
    setErroredSteps((prev) => {
      if (!prev.has(step.key)) return prev;
      const next = new Set(prev);
      next.delete(step.key);
      return next;
    });
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
    // College Email/Password below. Auto-filled above once there's exactly
    // one real choice, so this only actually blocks submission when there's
    // more than one department to pick from and none has been picked yet.
    if (!isLinkMode && !department) {
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
    // Date of Birth must come before Date of Joining - nobody joins on or
    // before the day they were born. The two live on different steps (DOB in
    // Personal Details, joining date on Identity & Employment) and in
    // different state, so neither field can catch this on its own; compared
    // here, once both are known to be filled in. Plain string compare is
    // enough - both inputs are type="date", so both are YYYY-MM-DD.
    if (
      personalDetails.dateOfBirth &&
      data.joiningDate &&
      personalDetails.dateOfBirth >= data.joiningDate
    ) {
      setErroredSteps(new Set<WizardStepKey>(["personal"]));
      setStepIndex(steps.findIndex((s) => s.key === "personal"));
      toast({
        variant: "destructive",
        title: "Date of Birth must be before Date of Joining",
        description: "Check the Date of Birth on Personal Details and the Date of Joining on Identity & Employment.",
      });
      return;
    }
    // Full Name (as per SSC) is the only display name - used everywhere this
    // faculty member's name is shown (see facultyDisplayName()).
    const displayName = personalDetails.legalName?.trim() || "";
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
      router.push(listPath);
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
          ? `Add the employment & profile details for ${linkName || "this person"}, who already has a login - filed under ${linkDepartment}`
          : "Add a new entry to your department's faculty register"}
      />

      {/* Step indicator - click any step to jump to it; steps with missing
          required fields are outlined in red. Jumping stays free (it is how
          you go back to fix something); it is Next that enforces the step. */}
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
                    <AvatarUploadField name={personalDetails.legalName || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
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
                      <Label htmlFor="apaarFacultyId">APAAR Faculty ID</Label>
                      <Input
                        id="apaarFacultyId" inputMode="numeric" maxLength={12}
                        {...register("apaarFacultyId")}
                        onChange={(e) => {
                          e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12);
                          void register("apaarFacultyId").onChange(e);
                        }}
                        placeholder="123456789012"
                      />
                      {errors.apaarFacultyId && <p className="text-sm text-destructive">{errors.apaarFacultyId.message}</p>}
                    </div>
                  </div>
                </div>

                {isLinkMode && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Department: </span>
                    <span className="font-medium">{linkDepartment}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This profile links to {linkName || "their"} existing login - no new account or password is created.
                    </p>
                  </div>
                )}

                {/* Always shown (outside link mode) so there's always a real
                    way to say which department a new faculty member belongs
                    to - including a sub-department, which a parent HOD who
                    owns only one top-level department still fully manages
                    the faculty roster of (see facultyDepartmentOptions).
                    Placed right after identity, before Role/Employment
                    Details, since it decides which department's register
                    this faculty member is filed under - the same slot the
                    read-only version above shows for a Sub-HOD link. */}
                {!isLinkMode && (
                  <div className="space-y-2">
                    <Label>Department *</Label>
                    <Select value={department} onValueChange={setDepartment}>
                      <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {isCollegeLevel
                        ? "Choose the department this faculty member belongs to."
                        : myDepartments.length > 1
                        ? "You manage more than one department (including sub-departments) - choose which one this faculty member belongs to."
                        : "This faculty member's department."}
                    </p>
                  </div>
                )}

                {!isLinkMode && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="collegeEmail">College Email *</Label>
                      <Input id="collegeEmail" type="email" {...register("collegeEmail")} placeholder="name@example.com" />
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
                      <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent>
                        {designationOptions.map((d) => <SelectItem key={d} value={d}>{designationLabel(d)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Employee Category *</Label>
                    <Select
                      value={employeeCategory ?? ""}
                      onValueChange={(v) => setValue("employeeCategory", v as EmployeeCategory)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select employee category" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.employeeCategory && <p className="text-sm text-destructive">{errors.employeeCategory.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Status *</Label>
                    <Select
                      value={status ?? "ACTIVE"}
                      onValueChange={(v) => setValue("status", v as FacultyStatus)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                      <SelectContent>
                        {SELECTABLE_FACULTY_STATUS_VALUES.map((s) => (
                          <SelectItem key={s} value={s}>{FACULTY_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.status && <p className="text-sm text-destructive">{errors.status.message}</p>}
                    <p className="text-xs text-muted-foreground">Defaults to Active for a faculty member who has already joined.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Highest Qualification *</Label>
                    <Select
                      value={qualIsOther ? OTHER_QUALIFICATION : (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(highestQualification) ? highestQualification : ""}
                      onValueChange={(v) => {
                        const other = v === OTHER_QUALIFICATION;
                        setQualIsOther(other);
                        // Picking "Others" clears the field so the text box
                        // below starts empty and its value lands in this same
                        // `highestQualification` string - there's no separate "other"
                        // column on FacultyMember, and the whole app (import,
                        // export, resume PDF, profile views) reads just this one.
                        setValue("highestQualification", other ? "" : v);
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
                      <Input {...register("highestQualification")} placeholder="e.g. B.Ed, MCA" />
                    )}
                    {errors.highestQualification && <p className="text-sm text-destructive">{errors.highestQualification.message}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="specialization">Specialization</Label>
                    <Input id="specialization" {...register("specialization")} placeholder="e.g. Machine Learning, VLSI" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="totalYearsOfExperience">Total Years of Experience</Label>
                    <Input id="totalYearsOfExperience" value={formatDuration(previewTotalExperience)} readOnly disabled className="bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Calculated automatically from the From/To dates added under Professional Experience, plus time served since Date of Joining.
                    </p>
                  </div>
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="joiningDate">Date of Joining *</Label>
                    <Input id="joiningDate" type="date" {...register("joiningDate")} />
                    {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="aicteFacultyId">AICTE Faculty ID</Label>
                  <Input id="aicteFacultyId" {...register("aicteFacultyId")} placeholder="AICTE Faculty ID" />
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Personal Email</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="faculty@example.com" />
                    {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="mobileNo">Mobile No *</Label>
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
                      id="mobileNo" type="tel" inputMode="numeric" autoComplete="off" maxLength={10}
                      {...register("mobileNo")}
                      onChange={(e) => {
                        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
                        void register("mobileNo").onChange(e);
                      }}
                      placeholder="9876543210"
                    />
                    {errors.mobileNo && <p className="text-sm text-destructive">{errors.mobileNo.message}</p>}
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
              </>
            )}

            {step.key === "personal" && (
              <PersonalDetailsFields
                value={personalDetails}
                onChange={setPersonalDetails}
                requiredFields={FACULTY_REQUIRED_PERSONAL_FIELDS}
                hiddenFields={["legalName", "esiNumber"]}
                showNameAsPerPan
                ratificationHistory
              />
            )}
            {step.key === "qualification" && <QualificationFields value={academicProfile} onChange={setAcademicProfile} collegeType={collegeType} />}
            {step.key === "experience" && <ExperienceFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "research" && <ResearchFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "mentorship" && <MentorshipFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "financial" && <FinancialFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "others" && <OthersFields value={academicProfile} onChange={setAcademicProfile} />}
            {step.key === "teaching-load" && (
              <TeachingAssignmentsEditor value={teachingRows} onChange={setTeachingRows} department={effectiveDepartment} />
            )}
            {step.key === "review" && (
              <p className="text-sm text-muted-foreground">
                {isLinkMode
                  ? <>Review the steps above using Back, then submit to complete <strong>{personalDetails.legalName || "this Sub-HOD"}</strong>&apos;s faculty profile.</>
                  : <>Review the steps above using Back, then submit to create <strong>{personalDetails.legalName || "this faculty member"}</strong>&apos;s account and record.</>}
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
