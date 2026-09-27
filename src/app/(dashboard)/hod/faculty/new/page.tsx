"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  GraduationCap,
  Lock,
  Mail,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HIGHEST_QUALIFICATION_OPTIONS } from "@/lib/import/fieldConstraints";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import {
  PersonalDetailsFields,
  getMissingRequiredPersonalFields,
  FACULTY_REQUIRED_PERSONAL_FIELDS,
  type PersonalDetailsValue,
} from "@/components/shared/PersonalDetailsFields";
import {
  QualificationFields,
  ExperienceFields,
  ResearchFields,
  MentorshipFields,
  FinancialFields,
  OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import {
  experienceBreakdown,
  totalYearsOfExperience,
  formatDuration,
  allPreviousExperienceEntries,
} from "@/lib/faculty/experienceCalc";
import { PHONE_REGEX, EMAIL_REGEX, APAAR_REGEX } from "@/lib/validations";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";
import {
  EMPLOYEE_CATEGORY_LABELS,
  FACULTY_STATUS_LABELS,
  SELECTABLE_FACULTY_STATUS_VALUES,
  FACULTY_STATUS_DATE_FIELD,
  FACULTY_STATUS_DATE_LABELS,
} from "@/types";
import type { DesignationCatalogItem, EmployeeCategory, FacultyStatus } from "@/types";
import { useCollegeType } from "@/hooks/useCollegeType";
import { designationLabel } from "@/lib/designations/config";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { facultyDepartmentOptions, isFacultyDestination, type FacultyDepartmentLike } from "@/lib/departments/facultyDepartmentOptions";
import type { FacultyProfileFields } from "@/types";

const OTHER_QUALIFICATION = "__OTHER__";

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
  resignedDate: z.string().optional(),
  retiredDate: z.string().optional(),
  retainershipDate: z.string().optional(),
  highestQualification: z.string().min(1, "Highest Qualification is required"),
  specialization: z.string().optional(),
  totalYearsOfExperience: z.number().min(0, "Cannot be negative").optional(),
  joiningDate: z.string().min(1, "Date of Joining is required"),
  aicteFacultyId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type WizardStepKey =
  | "core"
  | "personal"
  | "qualification"
  | "experience"
  | "research"
  | "mentorship"
  | "financial"
  | "teaching-load"
  | "others"
  | "review";

interface WizardStep {
  key: WizardStepKey;
  label: string;
  shortLabel: string;
  icon: typeof User;
  description: string;
}

export default function NewFacultyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { collegeType } = useCollegeType();
  const user = useAuthStore((s) => s.user);

  const [designationOptions, setDesignationOptions] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations?category=FACULTY");
        const data = (await res.json()) as { items?: DesignationCatalogItem[] };
        setDesignationOptions((data.items ?? []).filter((d) => d.isActive).map((d) => d.name));
      } catch {
        // Non-fatal
      }
    })();
  }, []);

  const ownDepartments = useMyDepartments();
  const isCollegeLevel =
    user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL" || ownDepartments.length === 0;

  type DeptRow = FacultyDepartmentLike & { isActive?: boolean };
  const [allDepartments, setAllDepartments] = useState<DeptRow[]>([]);
  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: DeptRow[] }>)
      .then((d) => setAllDepartments((d.departments ?? []).filter((dep) => dep.isActive !== false)))
      .catch(() => {});
  }, []);

  const myDepartments = isCollegeLevel
    ? allDepartments.filter((d) => isFacultyDestination(d, allDepartments)).map((d) => d.name)
    : facultyDepartmentOptions(allDepartments, ownDepartments).map((d) => d.name);
  const listPath = isCollegeLevel ? "/principal/faculty" : "/hod/faculty";

  const linkUid = searchParams.get("linkUid") ?? "";
  const linkDepartment = searchParams.get("department") ?? "";
  const linkName = searchParams.get("name") ?? "";
  const isLinkMode = !!(linkUid && linkDepartment);

  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>(() =>
    linkName ? { legalName: linkName } : {}
  );
  const [department, setDepartment] = useState("");
  const effectiveDepartment = isLinkMode ? linkDepartment : department || myDepartments[0] || "";

  useEffect(() => {
    if (!isLinkMode && !department && myDepartments.length === 1) setDepartment(myDepartments[0]);
  }, [isLinkMode, department, myDepartments]);

  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
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
      totalYearsOfExperience: 0,
      designation: "",
      password: "",
      status: "ACTIVE",
    },
  });
  const [erroredSteps, setErroredSteps] = useState<Set<WizardStepKey>>(new Set());

  const designation = watch("designation");
  const employeeCategory = watch("employeeCategory");
  const status = watch("status");
  const statusDateField = FACULTY_STATUS_DATE_FIELD[status as FacultyStatus];
  const highestQualification = watch("highestQualification");
  const [qualIsOther, setQualIsOther] = useState(false);
  const joiningDateValue = watch("joiningDate");

  const allExperienceEntries = useMemo(
    () => allPreviousExperienceEntries(academicProfile),
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

  const previewTotalExperience = useMemo(
    () => totalYearsOfExperience(allExperienceEntries, joiningDateValue),
    [allExperienceEntries, joiningDateValue]
  );

  const steps: WizardStep[] = useMemo(
    () => [
      {
        key: "core",
        label: "Identity & Employment",
        shortLabel: "Identity",
        icon: User,
        description: "Official ID, department, login credentials, and employment status",
      },
      {
        key: "personal",
        label: PROFILE_MODULES.personal.label,
        shortLabel: "Personal",
        icon: FileText,
        description: "Date of birth, blood group, identification details, and address",
      },
      {
        key: "qualification",
        label: PROFILE_MODULES.qualification.label,
        shortLabel: "Qualifications",
        icon: GraduationCap,
        description: "Degrees, academic background, and certifications",
      },
      {
        key: "experience",
        label: PROFILE_MODULES.experience.label,
        shortLabel: "Experience",
        icon: Briefcase,
        description: "Prior academic, industrial, and research service",
      },
      {
        key: "research",
        label: PROFILE_MODULES.research.label,
        shortLabel: "Research",
        icon: Award,
        description: "Publications, patents, book chapters, and research grants",
      },
      {
        key: "mentorship",
        label: PROFILE_MODULES.mentorship.label,
        shortLabel: "Mentorship",
        icon: UserCheck,
        description: "PhD guidance, workshops, and faculty development activities",
      },
      {
        key: "financial",
        label: PROFILE_MODULES.financial.label,
        shortLabel: "Funding",
        icon: DollarSign,
        description: "Sponsored research, consultancy projects, and seed funds",
      },
      {
        key: "teaching-load",
        label: PROFILE_MODULES["teaching-load"].label,
        shortLabel: "Teaching Load",
        icon: BookOpen,
        description: "Curriculum subject allocations and weekly lecture load",
      },
      {
        key: "others",
        label: PROFILE_MODULES.others.label,
        shortLabel: "Achievements",
        icon: Sparkles,
        description: "Professional memberships, awards, and institutional responsibilities",
      },
      {
        key: "review",
        label: "Review & Submit",
        shortLabel: "Review",
        icon: CheckCircle2,
        description: "Verify all inputs before committing to the institutional register",
      },
    ],
    []
  );

  const step = steps[stepIndex];

  const FIELD_LABELS: Record<string, string> = {
    employeeId: "Employee ID",
    collegeEmail: "College Email",
    password: "Login Password",
    mobileNo: "Mobile No",
    designation: "Designation",
    employeeCategory: "Employee Category",
    status: "Status",
    highestQualification: "Highest Qualification",
    totalYearsOfExperience: "Total Years of Experience",
    joiningDate: "Date of Joining",
    legalName: "Full Name (as per SSC)",
  };

  function findStepProblem(key: WizardStepKey): { title: string; description: string } | null {
    if (key === "core") {
      const problems = schema.safeParse(getValues()).error?.issues.map((i) => i.message) ?? [];
      if (!isLinkMode && !department) problems.push("Department is required");
      if (!isLinkMode && !getValues("collegeEmail")?.trim()) problems.push("College Email is required");
      if (!isLinkMode && !getValues("password")?.trim()) problems.push("Login Password is required");
      if (!personalDetails.legalName?.trim()) problems.push("Full Name (as per SSC) is required");
      const coreDateField = FACULTY_STATUS_DATE_FIELD[getValues("status") as FacultyStatus];
      if (coreDateField && !getValues(coreDateField)?.trim())
        problems.push(`${FACULTY_STATUS_DATE_LABELS[coreDateField]} is required`);
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

    return null;
  }

  function goNext() {
    const problem = findStepProblem(step.key);
    if (problem) {
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
    setErroredSteps(new Set<WizardStepKey>(["core"]));
    setStepIndex(steps.findIndex((s) => s.key === "core"));
    const missing = Object.keys(errs)
      .map((f) => FIELD_LABELS[f] ?? f)
      .join(", ");
    toast({
      variant: "destructive",
      title: "Some required fields are missing",
      description: `Identity & Employment: ${missing}`,
    });
  }

  const onSubmit = async (data: FormData) => {
    if (!isLinkMode && !department) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: "Identity & Employment: Department" });
      return;
    }
    if (!isLinkMode && (!data.collegeEmail?.trim() || !data.password?.trim())) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      const missing = [!data.collegeEmail?.trim() && "College Email", !data.password?.trim() && "Login Password"]
        .filter(Boolean)
        .join(", ");
      toast({ variant: "destructive", title: "Some required fields are missing", description: `Identity & Employment: ${missing}` });
      return;
    }
    if (!personalDetails.legalName?.trim()) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({ variant: "destructive", title: "Some required fields are missing", description: "Identity & Employment: Full Name (as per SSC)" });
      return;
    }
    const submitDateField = FACULTY_STATUS_DATE_FIELD[data.status as FacultyStatus];
    if (submitDateField && !data[submitDateField]?.trim()) {
      setErroredSteps(new Set<WizardStepKey>(["core"]));
      setStepIndex(steps.findIndex((s) => s.key === "core"));
      toast({
        variant: "destructive",
        title: "Some required fields are missing",
        description: `Identity & Employment: ${FACULTY_STATUS_DATE_LABELS[submitDateField]}`,
      });
      return;
    }
    const missingPersonal = getMissingRequiredPersonalFields(personalDetails, FACULTY_REQUIRED_PERSONAL_FIELDS);
    if (missingPersonal.length > 0) {
      setErroredSteps(new Set<WizardStepKey>(["personal"]));
      setStepIndex(steps.findIndex((s) => s.key === "personal"));
      toast({
        variant: "destructive",
        title: "Some required fields are missing",
        description: `Personal Details: ${missingPersonal.join(", ")}`,
      });
      return;
    }
    if (personalDetails.dateOfBirth && data.joiningDate && personalDetails.dateOfBirth >= data.joiningDate) {
      setErroredSteps(new Set<WizardStepKey>(["personal"]));
      setStepIndex(steps.findIndex((s) => s.key === "personal"));
      toast({
        variant: "destructive",
        title: "Date of Birth must be before Date of Joining",
        description: "Check the Date of Birth on Personal Details and the Date of Joining on Identity & Employment.",
      });
      return;
    }

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
            : department
            ? { department }
            : {}),
          academicProfile,
          ...personalDetails,
          ...(photoUrl ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };

      if (res.status === 409) {
        toast({ variant: "destructive", title: "Already exists", description: json.error });
        return;
      }
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: isLinkMode ? "Failed to complete profile" : "Failed to add faculty",
          description: json.error,
        });
        return;
      }

      if (json.id && teachingRows.length > 0) {
        const syncErrors = await syncTeachingAssignments(json.id, displayName, [], teachingRows);
        if (syncErrors.length > 0) {
          toast({
            variant: "destructive",
            title: "Some teaching assignments failed to save",
            description: syncErrors.join("; "),
          });
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
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* ── Top Navigation & Breadcrumbs ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit text-muted-foreground hover:text-foreground -ml-2">
          <Link href={listPath}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Faculty Register
          </Link>
        </Button>
        <Badge variant="outline" className="w-fit text-xs font-semibold px-2.5 py-0.5 border-primary/30 text-primary">
          {isLinkMode ? "Profile Completion Mode" : "New Faculty Onboarding"}
        </Badge>
      </div>

      {/* ── Hero Title Banner ── */}
      <div className="rounded-2xl border bg-gradient-to-r from-card via-card to-primary/5 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-2xs">
              <UserPlus className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {isLinkMode ? "Complete Sub-HOD Profile" : "Add Faculty Member"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {isLinkMode
                  ? `Complete employment and academic profile for ${linkName || "this Sub-HOD"} in ${linkDepartment}.`
                  : "Onboard new teaching faculty into the official college register with verified academic credentials."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1 font-medium text-xs">
              Step {stepIndex + 1} of {steps.length}
            </Badge>
          </div>
        </div>
      </div>

      {/* ── Sleek Modern Wizard Stepper ── */}
      <div className="relative">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
          {steps.map((s, i) => {
            const IconComponent = s.icon;
            const isCompleted = i < stepIndex && !erroredSteps.has(s.key);
            const isCurrent = i === stepIndex;
            const isError = erroredSteps.has(s.key);

            return (
              <button
                type="button"
                key={s.key}
                onClick={() => setStepIndex(i)}
                className={`group flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all shrink-0 border ${
                  isError
                    ? "border-destructive/50 bg-destructive/10 text-destructive ring-1 ring-destructive/30"
                    : isCurrent
                    ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                    : isCompleted
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                    isCurrent
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : isCompleted
                      ? "bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <Check className="h-3 w-3 stroke-[3]" /> : i + 1}
                </div>
                <span>{s.shortLabel}</span>
                {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Wizard Form Container ── */}
      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <Card className="shadow-xs border-border/80 overflow-hidden">
          <CardHeader className="bg-card/60 border-b p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <step.icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-foreground">{step.label}</CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {step.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 sm:p-6 space-y-6">
            {step.key === "core" && (
              <div className="space-y-6">
                {/* 1. Identity & Photo */}
                <div className="rounded-xl border bg-muted/10 p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <User className="h-4 w-4 text-primary" />
                    <span>Basic Identification &amp; Photo</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-5 items-start">
                    <div className="flex shrink-0 flex-col items-center gap-2 mx-auto sm:mx-0">
                      <AvatarUploadField
                        name={personalDetails.legalName || "?"}
                        photoUrl={photoUrl}
                        targetId={tempPhotoId}
                        onUploaded={setPhotoUrl}
                        onDeleted={() => setPhotoUrl(undefined)}
                      />
                      <span className="text-[11px] text-muted-foreground">Passport Photo</span>
                    </div>

                    <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                      <div className="space-y-1.5">
                        <Label htmlFor="employeeId" className="text-xs font-semibold">
                          Employee ID <span className="text-destructive">*</span>
                        </Label>
                        <Input id="employeeId" {...register("employeeId")} placeholder="e.g. EMP-1042" />
                        {errors.employeeId && <p className="text-xs text-destructive">{errors.employeeId.message}</p>}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="apaarFacultyId" className="text-xs font-semibold">
                          APAAR Faculty ID
                        </Label>
                        <Input
                          id="apaarFacultyId"
                          inputMode="numeric"
                          maxLength={12}
                          {...register("apaarFacultyId")}
                          onChange={(e) => {
                            e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12);
                            void register("apaarFacultyId").onChange(e);
                          }}
                          placeholder="12-digit APAAR ID"
                        />
                        {errors.apaarFacultyId && (
                          <p className="text-xs text-destructive">{errors.apaarFacultyId.message}</p>
                        )}
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="legalName" className="text-xs font-semibold">
                          Full Name (as per SSC) <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="legalName"
                          value={personalDetails.legalName ?? ""}
                          onChange={(e) =>
                            setPersonalDetails((p) => ({ ...p, legalName: e.target.value.toUpperCase() }))
                          }
                          placeholder="FULL NAME AS IN SSC CERTIFICATE"
                          className="uppercase font-medium"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Enter exact legal name as printed on 10th/SSC certificate. Used on official documents, registers, and resumes.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Institutional Placement & Account */}
                <div className="rounded-xl border bg-muted/10 p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span>Institutional Placement &amp; Portal Account</span>
                  </div>

                  {isLinkMode ? (
                    <div className="rounded-lg border bg-card p-3 text-sm flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Assigned Department</p>
                        <p className="font-bold text-foreground">{linkDepartment}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        Existing Login Linked
                      </Badge>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Department <span className="text-destructive">*</span>
                      </Label>
                      <Select value={department} onValueChange={setDepartment}>
                        <SelectTrigger className="bg-card">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          {myDepartments.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {isCollegeLevel
                          ? "Select the department or sub-department this faculty member will be registered under."
                          : "Your managed department / sub-department."}
                      </p>
                    </div>
                  )}

                  {!isLinkMode && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="collegeEmail" className="text-xs font-semibold">
                          College Email (Login Username) <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="collegeEmail"
                          type="email"
                          {...register("collegeEmail")}
                          placeholder="username@institution.edu.in"
                        />
                        {errors.collegeEmail && (
                          <p className="text-xs text-destructive">{errors.collegeEmail.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-xs font-semibold">
                          Temporary Login Password <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          {...register("password")}
                          placeholder="Minimum 8 characters"
                        />
                        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                        <p className="text-[11px] text-muted-foreground">
                          Faculty uses this password to log in. They can change it via Profile Settings.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Role & Employment Details */}
                <div className="rounded-xl border bg-muted/10 p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Briefcase className="h-4 w-4 text-primary" />
                    <span>Role &amp; Employment Terms</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Designation <span className="text-destructive">*</span>
                      </Label>
                      <Select value={designation} onValueChange={(v) => setValue("designation", v)}>
                        <SelectTrigger className="bg-card">
                          <SelectValue placeholder="Select designation" />
                        </SelectTrigger>
                        <SelectContent>
                          {designationOptions.map((d) => (
                            <SelectItem key={d} value={d}>
                              {designationLabel(d)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.designation && <p className="text-xs text-destructive">{errors.designation.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Employee Category <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={employeeCategory ?? ""}
                        onValueChange={(v) => setValue("employeeCategory", v as EmployeeCategory)}
                      >
                        <SelectTrigger className="bg-card">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(EMPLOYEE_CATEGORY_LABELS).map(([k, label]) => (
                            <SelectItem key={k} value={k}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.employeeCategory && (
                        <p className="text-xs text-destructive">{errors.employeeCategory.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Status <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={status ?? "ACTIVE"}
                        onValueChange={(v) => setValue("status", v as FacultyStatus)}
                      >
                        <SelectTrigger className="bg-card">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          {SELECTABLE_FACULTY_STATUS_VALUES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {FACULTY_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.status && <p className="text-xs text-destructive">{errors.status.message}</p>}
                    </div>
                  </div>

                  {statusDateField && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-lg border bg-destructive/5 border-destructive/20">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-destructive">
                          {FACULTY_STATUS_DATE_LABELS[statusDateField]} <span className="text-destructive">*</span>
                        </Label>
                        <Input type="date" {...register(statusDateField)} className="bg-card" />
                        {errors[statusDateField] && (
                          <p className="text-xs text-destructive">{errors[statusDateField]?.message}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="joiningDate" className="text-xs font-semibold">
                        Date of Joining <span className="text-destructive">*</span>
                      </Label>
                      <Input id="joiningDate" type="date" {...register("joiningDate")} className="bg-card" />
                      {errors.joiningDate && <p className="text-xs text-destructive">{errors.joiningDate.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Highest Qualification <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={
                          qualIsOther
                            ? OTHER_QUALIFICATION
                            : (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(highestQualification)
                            ? highestQualification
                            : ""
                        }
                        onValueChange={(v) => {
                          const other = v === OTHER_QUALIFICATION;
                          setQualIsOther(other);
                          setValue("highestQualification", other ? "" : v);
                        }}
                      >
                        <SelectTrigger className="bg-card">
                          <SelectValue placeholder="Select qualification" />
                        </SelectTrigger>
                        <SelectContent>
                          {HIGHEST_QUALIFICATION_OPTIONS.map((q) => (
                            <SelectItem key={q} value={q}>
                              {q}
                            </SelectItem>
                          ))}
                          <SelectItem value={OTHER_QUALIFICATION}>Others</SelectItem>
                        </SelectContent>
                      </Select>
                      {qualIsOther && (
                        <Input {...register("highestQualification")} placeholder="e.g. B.Ed, MCA" className="mt-1.5" />
                      )}
                      {errors.highestQualification && (
                        <p className="text-xs text-destructive">{errors.highestQualification.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="specialization" className="text-xs font-semibold">
                        Specialization
                      </Label>
                      <Input
                        id="specialization"
                        {...register("specialization")}
                        placeholder="e.g. VLSI, Machine Learning"
                        className="bg-card"
                      />
                    </div>
                  </div>

                  {/* Experience Live Preview Metric Card */}
                  <div className="p-3.5 rounded-lg border bg-primary/5 border-primary/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-foreground">Total Experience Preview</p>
                        <p className="text-[11px] text-muted-foreground">
                          Computed live from Joining Date + Professional Experience entries
                        </p>
                      </div>
                    </div>
                    <Badge variant="default" className="text-xs font-bold px-3 py-1 w-fit bg-primary">
                      {formatDuration(previewTotalExperience)}
                    </Badge>
                  </div>
                </div>

                {/* 4. Contact Details */}
                <div className="rounded-xl border bg-muted/10 p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Phone className="h-4 w-4 text-primary" />
                      <span>Contact Details</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setExtraPhones((p) => [...p, { label: "", number: "" }])}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Extra Phone
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mobileNo" className="text-xs font-semibold">
                        Primary Mobile No <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="mobileNo"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={10}
                        {...register("mobileNo")}
                        onChange={(e) => {
                          e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
                          void register("mobileNo").onChange(e);
                        }}
                        placeholder="10-digit mobile number"
                        className="bg-card font-mono"
                      />
                      {errors.mobileNo && <p className="text-xs text-destructive">{errors.mobileNo.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs font-semibold">
                        Personal Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        {...register("email")}
                        placeholder="personal@gmail.com"
                        className="bg-card"
                      />
                      {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                    </div>
                  </div>

                  {extraPhones.length > 0 && (
                    <div className="space-y-2.5 pt-2 border-t border-border/60">
                      <p className="text-xs font-semibold text-muted-foreground">Additional Phone Numbers</p>
                      {extraPhones.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 bg-card p-2 rounded-lg border">
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <TextInput
                              label="Label (optional)"
                              value={item.label}
                              onChange={(v) =>
                                setExtraPhones((prev) =>
                                  prev.map((p, idx) => (idx === i ? { ...p, label: v } : p))
                                )
                              }
                              placeholder="e.g. WhatsApp, Alternate"
                            />
                            <TextInput
                              label="Number"
                              type="tel"
                              value={item.number}
                              onChange={(v) =>
                                setExtraPhones((prev) =>
                                  prev.map((p, idx) => (idx === i ? { ...p, number: v } : p))
                                )
                              }
                              placeholder="10-digit number"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => setExtraPhones((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
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

            {step.key === "qualification" && (
              <QualificationFields value={academicProfile} onChange={setAcademicProfile} collegeType={collegeType} />
            )}

            {step.key === "experience" && (
              <ExperienceFields value={academicProfile} onChange={setAcademicProfile} />
            )}

            {step.key === "research" && (
              <ResearchFields value={academicProfile} onChange={setAcademicProfile} />
            )}

            {step.key === "mentorship" && (
              <MentorshipFields value={academicProfile} onChange={setAcademicProfile} />
            )}

            {step.key === "financial" && (
              <FinancialFields value={academicProfile} onChange={setAcademicProfile} />
            )}

            {step.key === "teaching-load" && (
              <TeachingAssignmentsEditor
                value={teachingRows}
                onChange={setTeachingRows}
                department={effectiveDepartment}
              />
            )}

            {step.key === "others" && <OthersFields value={academicProfile} onChange={setAcademicProfile} />}

            {/* ── Executive Review Step ── */}
            {step.key === "review" && (
              <div className="space-y-6">
                {/* Faculty Card Banner */}
                <div className="rounded-xl border bg-gradient-to-br from-card to-primary/5 p-5 shadow-xs flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
                  <div className="h-20 w-20 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-primary font-bold text-2xl overflow-hidden shrink-0 shadow-2xs">
                    {photoUrl ? (
                      <img src={photoUrl} alt="Faculty" className="h-full w-full object-cover" />
                    ) : (
                      personalDetails.legalName?.charAt(0) || "F"
                    )}
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-foreground truncate">
                      {personalDetails.legalName || "Faculty Name"}
                    </h2>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                      <Badge variant="default" className="text-xs bg-primary">
                        {designation ? designationLabel(designation) : "Designation"}
                      </Badge>
                      <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                        {effectiveDepartment || "Department"}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        ID: {getValues("employeeId") || "—"}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {status ? FACULTY_STATUS_LABELS[status as FacultyStatus] : "ACTIVE"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Key Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border bg-card p-4 space-y-2.5">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-primary" /> Official Credentials
                    </p>
                    <div className="text-xs space-y-1.5">
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">College Email:</span>
                        <span className="font-semibold text-foreground">{getValues("collegeEmail") || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Mobile Phone:</span>
                        <span className="font-semibold text-foreground font-mono">{getValues("mobileNo") || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Employee Category:</span>
                        <span className="font-semibold text-foreground">
                          {employeeCategory ? EMPLOYEE_CATEGORY_LABELS[employeeCategory as EmployeeCategory] : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-muted-foreground">Date of Joining:</span>
                        <span className="font-semibold text-foreground">{getValues("joiningDate") || "—"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-card p-4 space-y-2.5">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <GraduationCap className="h-3.5 w-3.5 text-primary" /> Academic &amp; Service Profile
                    </p>
                    <div className="text-xs space-y-1.5">
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Highest Qualification:</span>
                        <span className="font-semibold text-foreground">{getValues("highestQualification") || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Specialization:</span>
                        <span className="font-semibold text-foreground">{getValues("specialization") || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Total Experience:</span>
                        <span className="font-semibold text-primary">{formatDuration(previewTotalExperience)}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-muted-foreground">Teaching Load Staged:</span>
                        <span className="font-semibold text-foreground">{teachingRows.length} subjects</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Readiness Banner */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-emerald-950 dark:text-emerald-200">
                      All Requirements Validated &amp; Verified
                    </p>
                    <p className="text-emerald-800 dark:text-emerald-300">
                      Click below to commit this profile to the official faculty register. Login credentials will be generated and assigned teaching loads linked.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Footer Navigation Actions ── */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-6 border-t border-border/60">
          <Button
            type="button"
            variant="outline"
            onClick={() => (stepIndex === 0 ? router.back() : goBack())}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            {stepIndex === 0 ? "Cancel" : "Back"}
          </Button>

          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Step {stepIndex + 1} of {steps.length}
            </span>
            {step.key === "review" ? (
              <Button
                type="submit"
                disabled={submitting}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm font-semibold px-6"
              >
                {submitting ? (
                  "Submitting..."
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {isLinkMode ? "Save Profile" : "Add to Register"}
                  </>
                )}
              </Button>
            ) : (
              <Button type="button" onClick={goNext} className="gap-2 px-5">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
