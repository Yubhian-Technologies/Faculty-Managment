"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { FileText, MapPin, Monitor, UploadCloud, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Department, VacancyRequest, Course, Subject } from "@/types";

const ALL_DESIGNATIONS = [
  "Professor",
  "Associate Professor",
  "Assistant Professor",
  "Senior Lecturer",
  "Lecturer",
  "Technical",
  "Non-Technical",
  "Others",
] as const;

const schema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(6, "Phone required"),
  department: z.string().min(1, "Department required"),
  position: z.string().min(1, "Position required"),
  source: z.enum(["WALK_IN", "CAREERS_PAGE", "ADVERTISEMENT", "REFERRAL"]),
  interviewMode: z.enum(["ONLINE", "OFFLINE"]),
  vacancyId: z.string().optional(),
  referralType: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  referralName: z.string().optional(),
  referralPhone: z.string().optional(),
  referralDescription: z.string().optional(),
  residenceAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export default function NewCandidatePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const searchParams = useSearchParams();
  const prefilledVacancyId = searchParams.get("vacancyId") ?? "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [selectedVacancyId, setSelectedVacancyId] = useState<string>("");
  const [selectedDesignation, setSelectedDesignation] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [sameAddress, setSameAddress] = useState(false);

  // Teaching assignment preference (optional — for teaching faculty candidates)
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachCourseId, setTeachCourseId] = useState("");
  const [teachYear, setTeachYear] = useState("");
  const [teachSubjects, setTeachSubjects] = useState<Subject[]>([]);
  const [teachSelectedSubjectIds, setTeachSelectedSubjectIds] = useState<string[]>([]);

  // Resume upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [resumeUrl, setResumeUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const dept = user?.department ?? "";

    void Promise.all([
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => setDepartments(d.departments ?? []))
        .catch(() => {}),

      fetch("/api/college/courses")
        .then((r) => r.json() as Promise<{ courses: Course[] }>)
        .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => {}),

      Promise.all([
        fetch("/api/college/vacancy-requests?status=APPROVED")
          .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
          .then((d) => d.vacancyRequests ?? []),
        fetch("/api/college/hiring-batches")
          .then((r) => r.json() as Promise<{ batches: { vacancyId: string; currentPhase: string }[] }>)
          .then((d) => d.batches ?? [])
          .catch(() => [] as { vacancyId: string; currentPhase: string }[]),
      ]).then(([allVacancies, batches]) => {
        const completedVacancyIds = new Set(
          batches.filter((b) => b.currentPhase === "COMPLETED").map((b) => b.vacancyId)
        );
        const filtered = allVacancies.filter((v) =>
          (dept ? v.department === dept : true) &&
          (v.availableCount ?? v.requiredCount) > 0 &&
          !completedVacancyIds.has(v.id)
        );
        setVacancies(filtered);

        // Auto-select if vacancyId was passed in URL
        if (prefilledVacancyId) {
          const match = filtered.find((v) => v.id === prefilledVacancyId);
          if (match) {
            setSelectedVacancyId(match.id);
            setValue("vacancyId", match.id);
            syncDesignationFromVacancy(match.position);
          }
        }
      }).catch(() => {}),
    ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      department: user?.department ?? "",
      source: "WALK_IN",
      interviewMode: "OFFLINE",
      referralType: "INTERNAL",
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "Only PDF files are accepted" });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum size is 5 MB" });
      return;
    }
    setResumeFile(file);
    setResumeUrl(""); // reset previous upload if file changed
  }

  function clearResume() {
    setResumeFile(null);
    setResumeUrl("");
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadResume(): Promise<string> {
    if (!resumeFile) return "";
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", resumeFile);
      const ticker = setInterval(() => setUploadProgress((p) => Math.min((p ?? 0) + 10, 85)), 200);
      const res = await fetch("/api/upload/resume", { method: "POST", body: fd });
      clearInterval(ticker);
      setUploadProgress(100);
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Upload failed");
      }
      const { url } = await res.json() as { url: string };
      setResumeUrl(url);
      return url;
    } finally {
      setIsUploading(false);
    }
  }

  const teachCourse = courses.find((c) => c.id === teachCourseId) ?? null;
  const teachYearOptions = teachCourse ? Array.from({ length: teachCourse.durationYears }, (_, i) => i + 1) : [];

  function handleTeachCourseChange(courseId: string) {
    setTeachCourseId(courseId);
    setTeachYear("");
    setTeachSubjects([]);
    setTeachSelectedSubjectIds([]);
  }

  function handleTeachYearChange(year: string) {
    setTeachYear(year);
    setTeachSelectedSubjectIds([]);
    if (!teachCourseId || !year) { setTeachSubjects([]); return; }
    fetch(`/api/college/subjects?courseId=${encodeURIComponent(teachCourseId)}&year=${encodeURIComponent(year)}`)
      .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
      .then((d) => setTeachSubjects(d.subjects ?? []))
      .catch(() => setTeachSubjects([]));
  }

  function toggleTeachSubject(subjectId: string) {
    setTeachSelectedSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    );
  }

  function handleDesignationChange(val: string) {
    setSelectedDesignation(val);
    if (val !== "Others") {
      setCustomPosition("");
      setValue("position", val, { shouldValidate: true });
    }
    // "Others": position stays empty until user types in the custom field
  }

  function syncDesignationFromVacancy(position: string) {
    const known = ALL_DESIGNATIONS.find((d) => d !== "Others" && d === position);
    if (known) {
      setSelectedDesignation(known);
      setCustomPosition("");
    } else {
      setSelectedDesignation("Others");
      setCustomPosition(position);
    }
    setValue("position", position, { shouldValidate: true });
  }

  const onSubmit = async (data: FormData) => {
    if (!resumeFile && !resumeUrl) {
      toast({ variant: "destructive", title: "Resume required", description: "Please upload the candidate's resume (PDF)" });
      return;
    }

    let finalResumeUrl = resumeUrl;
    if (resumeFile && !resumeUrl) {
      try {
        finalResumeUrl = await uploadResume();
      } catch {
        toast({ variant: "destructive", title: "Resume upload failed", description: "Please try again" });
        return;
      }
    }

    try {
      const selectedSubjects = teachSubjects.filter((s) => teachSelectedSubjectIds.includes(s.id));
      const res = await fetch("/api/college/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          resumeUrl: finalResumeUrl,
          ...(teachCourseId ? { courseId: teachCourseId, courseName: teachCourse?.name ?? "" } : {}),
          ...(teachYear ? { year: Number(teachYear) } : {}),
          ...(selectedSubjects.length > 0 ? {
            preferredSubjectIds: selectedSubjects.map((s) => s.id),
            preferredSubjectNames: selectedSubjects.map((s) => s.name),
          } : {}),
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add candidate", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Candidate added" });
      router.push("/hod/candidates");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    }
  };

  const source = watch("source");
  const interviewMode = watch("interviewMode");
  const referralType = watch("referralType");
  const positionValue = watch("position");
  const isBusy = isSubmitting || isUploading;

  // Filter hiring requests by the typed position value
  const matchedVacancies = positionValue?.trim()
    ? vacancies.filter((v) =>
        v.position.toLowerCase().includes(positionValue.trim().toLowerCase())
      )
    : vacancies;

  // Auto-select when exactly one match; clear when the selected card no longer matches
  useEffect(() => {
    if (matchedVacancies.length === 1) {
      const only = matchedVacancies[0];
      if (selectedVacancyId !== only.id) {
        setSelectedVacancyId(only.id);
        setValue("vacancyId", only.id);
      }
    } else if (selectedVacancyId && !matchedVacancies.find((v) => v.id === selectedVacancyId)) {
      setSelectedVacancyId("");
      setValue("vacancyId", "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedVacancies.length, positionValue]);

  return (
    <div className="max-w-xl">
      <PageHeader title="Add Candidate" description="Manually add a candidate to the hiring pipeline" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input id="name" {...register("name")} placeholder="Dr. Ananya Sharma" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" {...register("email")} placeholder="candidate@email.com" />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input id="phone" {...register("phone")} placeholder="+91 98765 43210" />
                {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select
                  defaultValue={user?.department ?? ""}
                  onValueChange={(v) => setValue("department", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.department && <p className="text-sm text-destructive">{errors.department.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={selectedDesignation} onValueChange={handleDesignationChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select designation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_DESIGNATIONS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDesignation === "Others" && (
                  <Input
                    placeholder="Enter designation..."
                    value={customPosition}
                    onChange={(e) => {
                      setCustomPosition(e.target.value);
                      setValue("position", e.target.value, { shouldValidate: true });
                    }}
                  />
                )}
                {errors.position && <p className="text-sm text-destructive">{errors.position.message}</p>}
              </div>
            </div>

            {courses.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold">Teaching Assignment (optional)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    If this candidate is being hired to teach a specific course, set it here — it will carry over to their faculty profile once hired.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Course</Label>
                    <Select value={teachCourseId} onValueChange={handleTeachCourseChange}>
                      <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                      <SelectContent>
                        {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Year</Label>
                    <Select value={teachYear} onValueChange={handleTeachYearChange} disabled={!teachCourse}>
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {teachYearOptions.map((y) => <SelectItem key={y} value={String(y)}>Year {y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {teachYear && (
                  <div className="space-y-2">
                    <Label>Preferred Subjects</Label>
                    {teachSubjects.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No subjects set up for this year yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {teachSubjects.map((s) => {
                          const selected = teachSelectedSubjectIds.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleTeachSubject(s.id)}
                              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary font-medium"
                                  : "border-border hover:bg-muted"
                              }`}
                            >
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Source *</Label>
              <Select
                defaultValue="WALK_IN"
                onValueChange={(v) => setValue("source", v as FormData["source"], { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WALK_IN">Walk-in</SelectItem>
                  <SelectItem value="CAREERS_PAGE">Careers Page</SelectItem>
                  <SelectItem value="ADVERTISEMENT">Advertisement</SelectItem>
                  <SelectItem value="REFERRAL">Referral</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Referral details */}
            {source === "REFERRAL" && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="space-y-2">
                  <Label>Referral Type *</Label>
                  <div className="flex gap-3">
                    {(["INTERNAL", "EXTERNAL"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setValue("referralType", t, { shouldValidate: true })}
                        className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${
                          referralType === t
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-muted bg-background text-muted-foreground hover:border-muted-foreground/40"
                        }`}
                      >
                        {t === "INTERNAL" ? "Internal Referral" : "External Referral"}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {referralType === "INTERNAL"
                      ? "Referred by a current employee of this institution."
                      : "Referred by someone outside the institution."}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="referralName">Referrer Name *</Label>
                    <Input
                      id="referralName"
                      {...register("referralName")}
                      placeholder="Name of the person referring"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="referralPhone">Referrer Phone</Label>
                    <Input
                      id="referralPhone"
                      {...register("referralPhone")}
                      placeholder="+91 98765 43210"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="referralDescription">Description</Label>
                  <Textarea
                    id="referralDescription"
                    {...register("referralDescription")}
                    placeholder="How did they hear about this position? Any relevant context..."
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Interview Mode */}
            <div className="space-y-2">
              <Label>Interview Mode *</Label>
              <div className="grid grid-cols-2 gap-3">
                {(["OFFLINE", "ONLINE"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setValue("interviewMode", mode, { shouldValidate: true })}
                    className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all ${
                      interviewMode === mode
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted bg-background text-muted-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    {mode === "OFFLINE"
                      ? <MapPin className="h-5 w-5 shrink-0" />
                      : <Monitor className="h-5 w-5 shrink-0" />
                    }
                    <div>
                      <p className="text-sm font-medium">{mode === "OFFLINE" ? "Offline" : "Online"}</p>
                      <p className="text-xs opacity-70">{mode === "OFFLINE" ? "In-person demo class" : "Video call / meet"}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {vacancies.length > 0 && (
              <div className="space-y-2">
                <Label>Link to Hiring Request</Label>

                {/* Locked: came from pipeline — just show the linked card, no picker */}
                {prefilledVacancyId ? (
                  (() => {
                    const linked = vacancies.find((v) => v.id === prefilledVacancyId);
                    return linked ? (
                      <div className="flex items-center justify-between rounded-lg border-2 border-primary bg-primary/5 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-primary">{linked.position}</p>
                          {linked.qualification && (
                            <p className="text-xs text-muted-foreground">{linked.qualification}</p>
                          )}
                          <p className="text-xs text-muted-foreground/60 mt-0.5">{linked.department}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            {linked.availableCount ?? linked.requiredCount} posts open
                          </span>
                          <p className="text-[10px] text-primary font-medium mt-1">Auto-linked ✓</p>
                        </div>
                      </div>
                    ) : null;
                  })()
                ) : (
                <div className="flex items-center justify-between">
                  <span />
                  {selectedVacancyId && (
                    <button
                      type="button"
                      onClick={() => { setSelectedVacancyId(""); setValue("vacancyId", ""); }}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Clear
                    </button>
                  )}
                </div>
                )}
                {!prefilledVacancyId && <div className="space-y-0">

                {/* Filtered hint */}
                {positionValue?.trim() && (
                  <p className="text-xs text-muted-foreground">
                    {matchedVacancies.length === 0
                      ? `No hiring requests found for "${positionValue.trim()}"`
                      : `${matchedVacancies.length} hiring request${matchedVacancies.length !== 1 ? "s" : ""} for "${positionValue.trim()}"`}
                  </p>
                )}

                <div className="space-y-2">
                  {(matchedVacancies.length > 0 ? matchedVacancies : vacancies).map((v) => {
                    const isSelected = selectedVacancyId === v.id;
                    const refId = v.id.slice(-6).toUpperCase();
                    const isFiltered = positionValue?.trim() && matchedVacancies.length > 0;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedVacancyId("");
                            setValue("vacancyId", "");
                          } else {
                            setSelectedVacancyId(v.id);
                            setValue("vacancyId", v.id);
                            syncDesignationFromVacancy(v.position);
                          }
                        }}
                        className={`w-full text-left rounded-lg border-2 px-4 py-3 transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : isFiltered
                            ? "border-muted hover:border-primary/50"
                            : "border-muted hover:border-muted-foreground/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>
                                {v.position}
                              </p>
                              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                #{refId}
                              </span>
                            </div>
                            {v.qualification && (
                              <p className="text-xs text-muted-foreground mt-0.5">{v.qualification}</p>
                            )}
                            <p className="text-xs text-muted-foreground/60 mt-1">
                              Raised {formatDate(v.createdAt)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                              {v.availableCount ?? v.requiredCount} post{(v.availableCount ?? v.requiredCount) !== 1 ? "s" : ""} open
                            </span>
                            {isSelected && (
                              <p className="text-[10px] text-primary font-medium mt-1">Selected ✓</p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Select a designation above to auto-filter matching hiring requests. Selecting a card also fills the designation.
                </p>
                </div>}
              </div>
            )}

            {/* Address */}
            <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-semibold">Address Details</p>

              <div className="space-y-2">
                <Label htmlFor="residenceAddress">Residence Address</Label>
                <Textarea
                  id="residenceAddress"
                  {...register("residenceAddress")}
                  placeholder="Current / temporary address where the candidate lives"
                  rows={2}
                  onChange={(e) => {
                    register("residenceAddress").onChange(e);
                    if (sameAddress) setValue("permanentAddress", e.target.value);
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sameAddress"
                  checked={sameAddress}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSameAddress(checked);
                    if (checked) {
                      const res = (document.getElementById("residenceAddress") as HTMLTextAreaElement)?.value ?? "";
                      setValue("permanentAddress", res);
                    }
                  }}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <label htmlFor="sameAddress" className="text-sm text-muted-foreground cursor-pointer select-none">
                  Permanent address same as residence
                </label>
              </div>

              {!sameAddress && (
                <div className="space-y-2">
                  <Label htmlFor="permanentAddress">Permanent Address</Label>
                  <Textarea
                    id="permanentAddress"
                    {...register("permanentAddress")}
                    placeholder="Home town / permanent address"
                    rows={2}
                  />
                </div>
              )}
            </div>

            {/* Resume Upload */}
            <div className="space-y-2">
              <Label>Resume * <span className="text-xs font-normal text-muted-foreground">(PDF, max 5 MB)</span></Label>

              {!resumeFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  <UploadCloud className="h-7 w-7" />
                  <span className="text-sm font-medium">Click to upload resume</span>
                  <span className="text-xs">PDF only</span>
                </button>
              ) : (
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{resumeFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(resumeFile.size / 1024).toFixed(0)} KB
                        {resumeUrl && <span className="ml-2 text-green-600 font-medium">Uploaded</span>}
                      </p>
                    </div>
                    <button type="button" onClick={clearResume} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {uploadProgress !== null && !resumeUrl && (
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isBusy}>Cancel</Button>
              <Button type="submit" loading={isBusy}>Add Candidate</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
