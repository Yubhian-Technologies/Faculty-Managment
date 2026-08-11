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
import type { VacancyRequest, CandidateApplication } from "@/types";

const schema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(6, "Phone required"),
  source: z.enum(["WALK_IN", "CAREERS_PAGE", "ADVERTISEMENT", "REFERRAL"]),
  referralType: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  referralName: z.string().optional(),
  referralPhone: z.string().optional(),
  referralDescription: z.string().optional(),
  referralCollege: z.string().optional(),
  referralDesignation: z.string().optional(),
  referralInfluenceType: z.enum(["NONE", "MLA", "MP", "OTHER"]).optional(),
  referralInfluenceOther: z.string().optional(),
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

  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [isLoadingVacancies, setIsLoadingVacancies] = useState(true);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [candidateNames, setCandidateNames] = useState<Map<string, string>>(new Map());
  const [selectedVacancyId, setSelectedVacancyId] = useState<string>(prefilledVacancyId);
  const [vacancySearch, setVacancySearch] = useState("");
  const [interviewMode, setInterviewMode] = useState<"OFFLINE" | "ONLINE">("OFFLINE");
  const [sameAddress, setSameAddress] = useState(false);

  // Resume upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [resumeUrl, setResumeUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const dept = user?.department ?? "";

    void Promise.all([
      fetch("/api/college/vacancy-requests?status=APPROVED")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: { id: string; vacancyId: string; currentPhase: string }[] }>)
        .then((d) => d.batches ?? [])
        .catch(() => [] as { id: string; vacancyId: string; currentPhase: string }[]),
      fetch("/api/college/candidate-applications")
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => d.applications ?? [])
        .catch(() => [] as CandidateApplication[]),
      fetch("/api/college/candidates")
        .then((r) => r.json() as Promise<{ candidates: { id: string; name: string }[] }>)
        .then((d) => d.candidates ?? [])
        .catch(() => [] as { id: string; name: string }[]),
    ])
      .then(([allVacancies, batches, allApplications, allCandidates]) => {
        const completedVacancyIds = new Set(
          batches.filter((b) => b.currentPhase === "COMPLETED").map((b) => b.vacancyId)
        );
        // requiredCount is the actual "posts needed" figure (validated >=1 at
        // creation). availableCount means "current staff already in this role"
        // at creation time (see hod/vacancy/new) — a vacancy can and often does
        // have availableCount 0 (nobody in the role yet) while still needing
        // candidates, so it must never gate eligibility here.
        const filtered = allVacancies.filter((v) =>
          (dept ? v.department === dept : true) &&
          v.requiredCount > 0 &&
          !completedVacancyIds.has(v.id)
        );
        setVacancies(filtered);
        setApplications(allApplications);
        setCandidateNames(new Map(allCandidates.map((c) => [c.id, c.name])));
      })
      .catch(() => {})
      .finally(() => setIsLoadingVacancies(false));
  }, [user?.department]);

  function attachedCandidateNamesFor(v: VacancyRequest): string[] {
    return applications
      .filter((a) => a.vacancyRequestId === v.id)
      .map((a) => candidateNames.get(a.candidateId) ?? "Unknown")
      .filter((name, i, arr) => arr.indexOf(name) === i);
  }

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      source: "WALK_IN",
      referralType: "INTERNAL",
      referralInfluenceType: "NONE",
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
      const res = await fetch("/api/college/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          resumeUrl: finalResumeUrl,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        toast({ variant: "destructive", title: "Failed to add candidate", description: json.error });
        return;
      }

      // Candidate creation always succeeds standalone — attaching to a hiring
      // request is a separate step, done here only if the HOD picked one.
      if (selectedVacancyId) {
        const attachRes = await fetch("/api/college/candidate-applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: json.id, vacancyRequestId: selectedVacancyId, interviewMode }),
        });
        if (!attachRes.ok) {
          const attachJson = await attachRes.json() as { error?: string };
          toast({
            variant: "destructive",
            title: "Candidate added, but could not attach to the hiring request",
            description: attachJson.error,
          });
          router.push(`/hod/candidates/${json.id}`);
          return;
        }
      }

      toast({ variant: "success", title: "Candidate added" });
      router.push(selectedVacancyId ? "/hod/pipeline" : `/hod/candidates/${json.id}`);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    }
  };

  const source = watch("source");
  const referralType = watch("referralType");
  const referralInfluenceType = watch("referralInfluenceType");
  const isBusy = isSubmitting || isUploading;

  const matchedVacancies = vacancySearch.trim()
    ? vacancies.filter((v) => v.position.toLowerCase().includes(vacancySearch.trim().toLowerCase()))
    : vacancies;

  // Candidates can only be added while there's an active (approved, open-post,
  // not-yet-completed) hiring request to receive them - otherwise the pool
  // grows with nothing to attach them to.
  if (!isLoadingVacancies && vacancies.length === 0) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Add Candidate" description="Add a candidate to the pool — attach them to a hiring request now or later" />
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="font-medium">No active hiring request</p>
            <p className="text-sm text-muted-foreground">
              Candidates can only be added while your department has an approved hiring request with open posts. Raise or wait for one to be approved first.
            </p>
            <Button variant="outline" onClick={() => router.back()}>Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Add Candidate" description="Add a candidate to the pool — attach them to a hiring request now or later" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input id="name" {...register("name")} placeholder="Dr. Ananya Sharma" />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" {...register("email")} placeholder="candidate@email.com" />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input id="phone" type="tel" autoComplete="off" {...register("phone")} placeholder="+91 98765 43210" />
                {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
              </div>

              <div className="space-y-2 sm:col-span-2">
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

                {referralType === "INTERNAL" && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="referralCollege">Referrer&apos;s College *</Label>
                      <Input
                        id="referralCollege"
                        {...register("referralCollege")}
                        placeholder="College the referrer works at"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="referralDesignation">Referrer&apos;s Designation *</Label>
                      <Input
                        id="referralDesignation"
                        {...register("referralDesignation")}
                        placeholder="e.g. Assistant Professor"
                      />
                    </div>
                  </div>
                )}

                {referralType === "EXTERNAL" && (
                  <div className="space-y-2">
                    <Label>Is the referrer an influential person? *</Label>
                    <div className="flex flex-wrap gap-3">
                      {([
                        { value: "NONE", label: "No" },
                        { value: "MLA", label: "MLA" },
                        { value: "MP", label: "MP" },
                        { value: "OTHER", label: "Other" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setValue("referralInfluenceType", opt.value, { shouldValidate: true })}
                          className={`flex-1 min-w-[5rem] rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${
                            referralInfluenceType === opt.value
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-muted bg-background text-muted-foreground hover:border-muted-foreground/40"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {referralInfluenceType === "OTHER" && (
                      <Input
                        {...register("referralInfluenceOther")}
                        placeholder="Specify who referred (e.g. MLC, Corporator, ...)"
                      />
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="referralDescription">Description</Label>
                  <Textarea
                    id="referralDescription"
                    {...register("referralDescription")}
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Optional: attach to a hiring request now */}
            <div className="space-y-2">
              {isLoadingVacancies ? (
                <p className="text-sm text-muted-foreground">Loading hiring requests...</p>
              ) : prefilledVacancyId ? (
                (() => {
                  const linked = vacancies.find((v) => v.id === prefilledVacancyId);
                  if (!linked) {
                    return (
                      <p className="text-sm text-destructive">
                        This hiring request isn&rsquo;t available to attach — it may not be approved
                        anymore or have no open posts left. The candidate will still be created; attach
                        them from the candidates list instead.
                      </p>
                    );
                  }
                  const alreadyAttached = attachedCandidateNamesFor(linked);
                  return (
                    <div className="rounded-lg border-2 border-primary bg-primary/5 px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-primary">{linked.position}</p>
                          {linked.qualification && (
                            <p className="text-xs text-muted-foreground">{linked.qualification}</p>
                          )}
                          <p className="text-xs text-muted-foreground/60 mt-0.5">{linked.department}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            {linked.requiredCount} post{linked.requiredCount !== 1 ? "s" : ""} open
                          </span>
                        </div>
                      </div>
                      {alreadyAttached.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Already attached: {alreadyAttached.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={vacancySearch}
                      onChange={(e) => setVacancySearch(e.target.value)}
                      placeholder="Search by position..."
                      className="h-9"
                    />
                    {selectedVacancyId && (
                      <button
                        type="button"
                        onClick={() => setSelectedVacancyId("")}
                        className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {matchedVacancies.map((v) => {
                      const isSelected = selectedVacancyId === v.id;
                      const alreadyAttached = attachedCandidateNamesFor(v);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVacancyId(isSelected ? "" : v.id)}
                          className={`w-full text-left rounded-lg border-2 px-4 py-3 transition-all ${
                            isSelected ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>
                                {v.position}
                              </p>
                              {v.qualification && (
                                <p className="text-xs text-muted-foreground mt-0.5">{v.qualification}</p>
                              )}
                              <p className="text-xs text-muted-foreground/60 mt-1">
                                Raised {formatDate(v.createdAt)}
                              </p>
                              {alreadyAttached.length > 0 && (
                                <p className="text-xs text-muted-foreground/80 mt-1">
                                  {alreadyAttached.length} candidate{alreadyAttached.length !== 1 ? "s" : ""} already attached:{" "}
                                  {alreadyAttached.join(", ")}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                                {v.requiredCount} post{v.requiredCount !== 1 ? "s" : ""} open
                              </span>
                              {isSelected && (
                                <p className="text-[10px] text-primary font-medium mt-1">Selected ✓</p>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {matchedVacancies.length === 0 && (
                      <p className="text-xs text-muted-foreground">No hiring requests match &ldquo;{vacancySearch.trim()}&rdquo;</p>
                    )}
                  </div>
                </div>
              )}

              {selectedVacancyId && (
                <div className="space-y-2 pt-2">
                  <Label>Interview Mode</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["OFFLINE", "ONLINE"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setInterviewMode(mode)}
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
              )}
            </div>

            {/* Address */}
            <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-semibold">Address Details</p>

              <div className={`grid grid-cols-1 gap-4 ${sameAddress ? "" : "sm:grid-cols-2"}`}>
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
                    <button type="button" onClick={clearResume} aria-label="Remove resume" className="text-muted-foreground hover:text-destructive">
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
