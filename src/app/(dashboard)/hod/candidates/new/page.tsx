"use client";

import { useEffect, useState } from "react";
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
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { Department, VacancyRequest } from "@/types";

const schema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(6, "Phone required"),
  department: z.string().min(1, "Department required"),
  position: z.string().min(1, "Position required"),
  source: z.enum(["REFERRAL", "CAREERS_PAGE"]),
  vacancyId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function NewCandidatePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);

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
      source: "REFERRAL",
    },
  });

  const source = watch("source");

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch("/api/college/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
              <Label>Source</Label>
              <Select
                defaultValue="REFERRAL"
                onValueChange={(v) => setValue("source", v as "REFERRAL" | "CAREERS_PAGE")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REFERRAL">Referral / Walk-in</SelectItem>
                  <SelectItem value="CAREERS_PAGE">Careers Page</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add Candidate</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
