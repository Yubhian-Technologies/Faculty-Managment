"use client";

import { useEffect, useMemo, useState } from "react";
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
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { SupportingStaffModuleEditor, type SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import { getSupportingStaffProfileModules } from "@/lib/supportingStaff/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { EMPLOYMENT_TYPE_LABELS } from "@/types";
import type { EmploymentType, Department } from "@/types";

const schema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  collegeEmail: z.string().min(1, "College email is required").email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  designation: z.string().min(1, "Designation is required"),
  otherDesignationTitle: z.string().optional(),
  experienceYears: z.number().min(0, "Cannot be negative"),
  joiningDate: z.string().min(1, "Joining date is required"),
  employmentType: z.string().min(1, "Employment type is required"),
  department: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type WizardStepKey = "core" | "personal" | "qualifications" | "responsibilities" | "training" | "achievements" | "others" | "review";

interface WizardStep {
  key: WizardStepKey;
  label: string;
}

// Steps beyond "core" reuse SupportingStaffModuleEditor, the same per-module
// field renderer the View/Edit hub uses (SUPPORTING_STAFF_MODULES) - so the
// wizard's modules match what Edit later shows, 1:1.
export default function NewNonTechnicalStaffPage() {
  const router = useRouter();
  const { collegeType } = useCollegeType();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [record, setRecord] = useState<SupportingStaffEditRecord>({});
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* department assignment is optional */ });
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { experienceYears: 0, designation: "", employmentType: "PERMANENT", password: "", department: "" },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

  const designation = watch("designation");
  const employmentType = watch("employmentType");
  const department = watch("department");
  const name = watch("name");

  const steps: WizardStep[] = useMemo(() => [
    { key: "core", label: "Identity & Employment" },
    ...getSupportingStaffProfileModules().map((m) => ({ key: m.key as WizardStepKey, label: m.label })),
    { key: "review", label: "Review & Submit" },
  ], []);

  const step = steps[stepIndex];

  // All required fields live on the "core" step; deferred to submit time so
  // steps can be navigated freely (see onInvalid).
  const FIELD_LABELS: Record<string, string> = {
    employeeId: "Employee ID", name: "Full Name", collegeEmail: "College Email",
    password: "Login Password", designation: "Designation",
    experienceYears: "Years of Experience", joiningDate: "Joining Date",
    employmentType: "Employment Type",
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
    setSubmitting(true);
    try {
      const res = await fetch("/api/college/supporting-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          staffCategory: "NON_TECHNICAL",
          ...record,
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

      toast({ variant: "success", title: "Non-Technical staff added", description: `${data.name} has been added.` });
      router.push("/college-office/non-technical-staff");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add Non-Technical Staff" description="Add a Non-Technical staff member for your college" />

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
                      <Input id="name" {...register("name")} placeholder="Lakshmi Devi" />
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
                    <Input id="phone" type="tel" autoComplete="off" {...register("phone")} placeholder="+91 98765 43210" />
                  </div>
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
                      <SelectContent><DesignationOptions collegeType={collegeType} kind="non-technical" /></SelectContent>
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
                  <Select value={department || "__none__"} onValueChange={(v) => setValue("department", v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Centrally managed (no department)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Centrally managed (no department)</SelectItem>
                      {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Optional - leave unassigned for centrally-managed roles like Librarian or Accountant.</p>
                </div>

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
                Review the steps above using Back, then submit to create <strong>{name || "this staff member"}</strong>&apos;s account and record.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between pt-6">
          <Button type="button" variant="outline" onClick={() => (stepIndex === 0 ? router.back() : goBack())}>
            <ChevronLeft className="h-4 w-4 mr-2" />{stepIndex === 0 ? "Cancel" : "Back"}
          </Button>
          {step.key === "review" ? (
            <Button type="submit" loading={submitting}>Add Staff Member</Button>
          ) : (
            <Button type="button" onClick={() => void goNext()}>Next<ChevronRight className="h-4 w-4 ml-2" /></Button>
          )}
        </div>
      </form>
    </div>
  );
}
