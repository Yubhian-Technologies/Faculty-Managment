"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { vacancyRequestSchema, type VacancyRequestFormData } from "@/lib/validations";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { FacultyNorms } from "@/types";

export default function NewVacancyPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [norms, setNorms] = useState<FacultyNorms | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/faculty-norms")
      .then((r) => r.json() as Promise<{ norms: FacultyNorms }>)
      .then((d) => setNorms(d.norms))
      .catch(() => { /* norms are informational only, silent fail */ });
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VacancyRequestFormData>({
    resolver: zodResolver(vacancyRequestSchema),
    defaultValues: {
      department: user?.department ?? "",
      requiredCount: 1,
      availableCount: 0,
    },
  });

  const onSubmit = async (data: VacancyRequestFormData) => {
    try {
      const res = await fetch("/api/college/vacancy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json() as { id?: string; error?: string };

      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to submit", description: json.error });
        return;
      }

      toast({ variant: "success", title: "Vacancy request submitted", description: "The Principal has been notified." });
      router.push("/hod/vacancy");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Vacancy Request"
        description="Submit a new faculty hiring request to the Principal"
      />

      {/* Govt. Norms Reference Panel */}
      {norms && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
              <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                {norms.regulatoryBody}
              </span>
              Govt. Faculty Norms (Reference)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 text-sm text-blue-900 pb-4">
            <div>
              <p className="text-xs font-medium text-blue-600">Student : Faculty Ratio</p>
              <p className="font-semibold">{norms.studentFacultyRatio} : 1</p>
            </div>
            <div>
              <p className="text-xs font-medium text-blue-600">Min. Faculty per Dept</p>
              <p className="font-semibold">{norms.defaultMinFacultyPerDept}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-blue-600">Teaching Hours / Week</p>
              <p className="font-semibold">{norms.teachingHoursPerWeek} hrs</p>
            </div>
            {norms.positionNorms.length > 0 && (
              <div className="sm:col-span-3">
                <p className="text-xs font-medium text-blue-600 mb-1">Position Requirements</p>
                <div className="flex flex-wrap gap-2">
                  {norms.positionNorms.map((p) => (
                    <span key={p.designation} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {p.designation}: min {p.requiredPerDept}/dept · {p.minQualification}
                      {p.minExperienceYears > 0 ? ` · ${p.minExperienceYears}y exp` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vacancy Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">Department *</Label>
                <Input id="department" {...register("department")} placeholder="e.g. Computer Science" />
                {errors.department && <p className="text-sm text-destructive">{errors.department.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">Position / Designation *</Label>
                <Input id="position" {...register("position")} placeholder="e.g. Assistant Professor" />
                {errors.position && <p className="text-sm text-destructive">{errors.position.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="requiredCount">Required Count *</Label>
                <Input
                  id="requiredCount"
                  type="number"
                  min={1}
                  {...register("requiredCount", { valueAsNumber: true })}
                />
                {errors.requiredCount && <p className="text-sm text-destructive">{errors.requiredCount.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="availableCount">Current Available Staff</Label>
                <Input
                  id="availableCount"
                  type="number"
                  min={0}
                  {...register("availableCount", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="justification">Justification *</Label>
              <Textarea
                id="justification"
                {...register("justification")}
                placeholder="Explain why this vacancy is required..."
                rows={4}
              />
              {errors.justification && <p className="text-sm text-destructive">{errors.justification.message}</p>}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sticky bottom-4 bg-background/80 backdrop-blur py-3 -mx-6 px-6 border-t mt-6">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Submit to Principal
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
