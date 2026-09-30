"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2, User, UserPlus, CheckCircle2 } from "lucide-react";
import { WizardPage, WizardHero, WizardStepper, WizardStepHeader, WizardFooter, type ChromeStep } from "@/components/shared/WizardChrome";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { getMissingRequiredPersonalFields, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { getSupportingStaffProfileModules } from "@/lib/supportingStaff/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { useActiveDepartments } from "@/hooks/useActiveDepartments";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { PHONE_REGEX, EMAIL_REGEX, APAAR_REGEX } from "@/lib/validations";

const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  apaarFacultyId: z.string().regex(APAAR_REGEX, "APAAR Faculty ID must be exactly 12 digits").optional().or(z.literal("")),
  email: z.string().regex(EMAIL_REGEX, "Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().min(1, "College email is required").regex(EMAIL_REGEX, "Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  mobileNo: z.string().min(1, "Mobile No is required").regex(PHONE_REGEX, "Mobile No must be exactly 10 digits, starting with 6, 7, 8 or 9"),
  designation: z.string().min(1, "Designation is required"),
  highestQualification: z.string().min(1, "Highest Qualification is required"),
  joiningDate: z.string().min(1, "Joining date is required"),
  department: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type WizardStepKey = "core" | "personal" | "qualifications" | "responsibilities" | "training" | "achievements" | "others" | "review";

interface WizardStep extends ChromeStep {
  key: WizardStepKey;
}

// Steps beyond "core" reuse SupportingStaffModuleEditor, the same per-module
// field renderer the View/Edit hub uses (SUPPORTING_STAFF_MODULES) - so the
// wizard's modules match what Edit later shows, 1:1.
//
// College Office (whole-college Non-Technical staff) or Library (its own
// unit only, department locked to "Library" - see the LIBRARY branches in
// api/college/supporting-staff/route.ts) - also mounted at
// /library/staff/new (re-exported from there), same isLibrary pattern as
// the sibling [id] view/edit pages. Principal/VP no longer have a create
// path for Supporting Staff of either category (see
// canRoleCreateSupportingStaff in lib/supportingStaff/roleCategory.ts);
// their /principal/staff/non-technical/new page was removed rather than kept
// around to always 403.
export default function NewNonTechnicalStaffPage() {
  const router = useRouter();
  const { collegeType } = useCollegeType();
  const user = useAuthStore((s) => s.user);
  const isLibrary = user?.role === "LIBRARY";
  const listPath = isLibrary ? "/library/staff" : "/college-office/non-technical-staff";
  const departments = useActiveDepartments();
  const [record, setRecord] = useState<SupportingStaffEditRecord>({});
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
    defaultValues: { designation: "", password: "", department: isLibrary ? "Library" : "" },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

  const designation = watch("designation");
  const department = watch("department");

  // Covers the rare case the persisted auth store hydrates a tick after
  // mount (defaultValues above only runs once, at mount).
  useEffect(() => {
    if (isLibrary) setValue("department", "Library");
  }, [isLibrary, setValue]);

  const steps: WizardStep[] = useMemo(() => [
    { key: "core", label: "Identity & Employment", icon: User, description: "Official ID, login credentials, designation and employment details" },
    ...getSupportingStaffProfileModules().map((m) => ({ key: m.key as WizardStepKey, label: m.label, icon: m.icon })),
    { key: "review", label: "Review & Submit", icon: CheckCircle2, description: "Verify all inputs before committing to the institutional register" },
  ], []);

  const step = steps[stepIndex];

  // All required fields live on the "core" step; deferred to submit time so
  // steps can be navigated freely (see onInvalid).
  const FIELD_LABELS: Record<string, string> = {
    employeeId: "Employee ID", collegeEmail: "College Email",
    password: "Login Password", mobileNo: "Mobile No", designation: "Designation",
    highestQualification: "Highest Qualification", joiningDate: "Date of Joining",
    legalName: "Full Name (as per SSC)",
  };

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function onInvalid(errs: typeof errors) {
    setErroredSteps(new Set<WizardStepKey>(["core"]));
    setStepIndex(steps.findIndex((s) => s.key === "core"));
    const missing = Object.keys(errs).map((f) => FIELD_LABELS[f] ?? f).join(", ");
    toast({ variant: "destructive", title: "Some required fields are missing", description: `Identity & Employment: ${missing}` });
  }

  const onSubmit = async (data: FormData) => {
    // Full Name (as per SSC) lives in `record` (shared with the "personal"
    // step's state) but is rendered on the "core" step (right after Employee
    // ID, matching Faculty's own field order) - not zod-validated, so it's
    // checked here, same pattern as hod/faculty/new/page.tsx, and routes back
    // to "core" (not "personal", where the input no longer visually is).
    if (!record.legalName?.trim()) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: "Identity & Employment: Full Name (as per SSC)" });
      return;
    }
    // Remaining Personal Details isn't zod-validated (SupportingStaffModuleEditor's
    // "personal" step is plain React state) - checked here instead, same
    // pattern as Add Faculty's equivalent check.
    const missingPersonal = getMissingRequiredPersonalFields(record, SUPPORTING_STAFF_REQUIRED_PERSONAL_FIELDS);
    if (missingPersonal.length > 0) {
      setErroredSteps(new Set<WizardStepKey>(["personal"]));
      setStepIndex(steps.findIndex((s) => s.key === "personal"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: `Personal Details: ${missingPersonal.join(", ")}` });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/college/supporting-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          staffCategory: "NON_TECHNICAL",
          ...record,
          additionalPhoneNumbers: extraPhones.filter((p) => p.number.trim()),
          supportingStaffProfile: record.supportingStaffProfile ?? {},
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

      toast({ variant: "success", title: isLibrary ? "Library staff added" : "Non-Technical staff added", description: `${record.legalName || "The staff member"} has been added.` });
      router.push(listPath);
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardPage>
      <WizardHero
        icon={UserPlus}
        title={isLibrary ? "Add Library Staff" : "Add Non-Technical Staff"}
        description={isLibrary ? "Add a staff member to your Library unit" : "Add a Non-Technical staff member for your college"}
        badge={`Step ${stepIndex + 1} of ${steps.length}`}
      />
      <WizardStepper steps={steps} currentKey={step.key} onSelect={setStepIndex} errored={erroredSteps} completedBefore={stepIndex} />

      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <Card className="shadow-xs border-border/80 overflow-hidden">
          <WizardStepHeader step={step} />
          <CardContent className="p-5 sm:p-6 space-y-5">
            {step.key === "core" && (
              <>
                <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
                  <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                    <Label>Profile Photo</Label>
                    <AvatarUploadField name={record.legalName || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
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
                        value={record.legalName ?? ""}
                        onChange={(e) => setRecord((r) => ({ ...r, legalName: e.target.value.toUpperCase() }))}
                        placeholder="FULL NAME IN CAPITALS"
                        className="uppercase"
                      />
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
                  <p className="text-xs text-muted-foreground">Share this with the staff member so they can log in with their college email.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Designation *</Label>
                    <Select value={designation} onValueChange={(v) => setValue("designation", v)}>
                      <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent><DesignationOptions kind="non-technical" /></SelectContent>
                    </Select>
                    {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="highestQualification">Highest Qualification *</Label>
                    <Input id="highestQualification" {...register("highestQualification")} placeholder="e.g. Diploma, B.Com, ITI" />
                    {errors.highestQualification && <p className="text-sm text-destructive">{errors.highestQualification.message}</p>}
                  </div>
                </div>

                {isLibrary ? (
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Input value="Library" disabled />
                    <p className="text-xs text-muted-foreground">Library staff are always filed under the Library unit.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select value={department || "__none__"} onValueChange={(v) => setValue("department", v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Centrally managed (no department)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Centrally managed (no department)</SelectItem>
                        {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Optional - leave unassigned for centrally-managed roles like Librarian or Accountant.</p>
                  </div>
                )}

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="joiningDate">Date of Joining *</Label>
                    <Input id="joiningDate" type="date" {...register("joiningDate")} />
                    {errors.joiningDate && <p className="text-sm text-destructive">{errors.joiningDate.message}</p>}
                    <p className="text-xs text-muted-foreground">
                      Total Years of Experience is calculated automatically from this date.
                    </p>
                  </div>
                </div>

                <div className="pt-2 pb-1 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Contact Details</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Personal Email</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="staff@example.com" />
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
              </>
            )}

            {step.key !== "core" && step.key !== "review" && (
              <SupportingStaffModuleEditor
                moduleKey={step.key}
                record={record}
                onChange={(patch) => setRecord((r) => ({ ...r, ...patch }))}
                collegeType={collegeType}
              />
            )}

            {step.key === "review" && (
              <p className="text-sm text-muted-foreground">
                Review the steps above using Back, then submit to create <strong>{record.legalName || "this staff member"}</strong>&apos;s account and record.
              </p>
            )}
          </CardContent>
        </Card>

        <WizardFooter
          stepIndex={stepIndex}
          total={steps.length}
          isLast={step.key === "review"}
          submitting={submitting}
          submitLabel="Add Staff Member"
          onBack={() => (stepIndex === 0 ? router.back() : goBack())}
          onNext={goNext}
        />
      </form>
    </WizardPage>
  );
}
