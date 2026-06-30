"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { FileText, UploadCloud, X } from "lucide-react";
import type { Department, VacancyRequest } from "@/types";

const schema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(6, "Phone required"),
  department: z.string().min(1, "Department required"),
  position: z.string().min(1, "Position required"),
  source: z.enum(["WALK_IN", "CAREERS_PAGE", "ADVERTISEMENT", "REFERRAL"]),
  vacancyId: z.string().optional(),
  referralType: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  referralName: z.string().optional(),
  referralPhone: z.string().optional(),
  referralDescription: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export default function NewCandidatePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);

  // Resume upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [resumeUrl, setResumeUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
    fetch("/api/college/vacancy-requests?status=APPROVED")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => {});
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
        body: JSON.stringify({ ...data, resumeUrl: finalResumeUrl }),
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
  const referralType = watch("referralType");
  const isBusy = isSubmitting || isUploading;

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
                <Label htmlFor="position">Position *</Label>
                <Input id="position" {...register("position")} placeholder="e.g. Assistant Professor" />
                {errors.position && <p className="text-sm text-destructive">{errors.position.message}</p>}
              </div>
            </div>

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

            {vacancies.length > 0 && (
              <div className="space-y-2">
                <Label>Link to Vacancy (optional)</Label>
                <Select onValueChange={(v) => setValue("vacancyId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select approved vacancy" />
                  </SelectTrigger>
                  <SelectContent>
                    {vacancies.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.position} — {v.department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
