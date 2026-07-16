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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { createUserSchema } from "@/lib/validations";
import type { z } from "zod";

type StaffFormData = z.infer<ReturnType<typeof createUserSchema.omit<{ collegeId: true }>>>;
import { ROLE_LABELS } from "@/types";
import { toast } from "@/hooks/useToast";
import type { Department, FacultyProfileFields } from "@/types";

const PRINCIPAL_ASSIGNABLE_ROLES = [
  { value: "VICE_PRINCIPAL", label: ROLE_LABELS.VICE_PRINCIPAL },
  { value: "HOD", label: ROLE_LABELS.HOD },
  { value: "COLLEGE_OFFICE", label: ROLE_LABELS.COLLEGE_OFFICE },
] as const;

export default function NewStaffPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [tempPhotoId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<StaffFormData>({
    resolver: zodResolver(createUserSchema.omit({ collegeId: true })),
    defaultValues: { role: "HOD" },
  });

  const role = watch("role");
  const name = watch("name");

  const onSubmit = async (data: StaffFormData) => {
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...personalDetails,
          ...(data.role === "VICE_PRINCIPAL" || data.role === "HOD" ? { academicProfile } : {}),
          ...(photoUrl ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      const json = await res.json() as { uid?: string; error?: string };

      if (res.status === 409) {
        toast({ variant: "destructive", title: "Email already in use", description: json.error });
        return;
      }
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create account", description: json.error });
        return;
      }

      toast({ variant: "success", title: "Account created", description: `${data.name} can now log in.` });
      router.push("/principal/staff");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Staff Member"
        description="Create login access for HOD or College Office staff"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={name || "?"} photoUrl={photoUrl} targetId={tempPhotoId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl(undefined)} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" {...register("name")} placeholder="Dr. Ramesh Kumar" />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" {...register("email")} placeholder="staff@college.edu" />
                  {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">Temporary Password *</Label>
                <Input id="password" type="password" {...register("password")} placeholder="Min 8 characters" />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
                <p className="text-xs text-muted-foreground">Share this with the staff member to log in for the first time.</p>
              </div>

              <div className="space-y-2">
                <Label>Role *</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setValue("role", v as StaffFormData["role"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINCIPAL_ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
              </div>
            </div>

            {role === "HOD" && (
              <div className="space-y-2">
                <Label>Department *</Label>
                {departments.length > 0 ? (
                  <Select onValueChange={(v) => setValue("department", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.name}>
                          {d.name} ({d.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    No departments yet.{" "}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => router.push("/principal/departments")}
                    >
                      Add departments first
                    </button>
                  </div>
                )}
                {errors.department && <p className="text-sm text-destructive">{errors.department.message}</p>}
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Create Account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
        <CardContent>
          <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
        </CardContent>
      </Card>

      {(role === "VICE_PRINCIPAL" || role === "HOD") && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
          <CardContent>
            <AcademicProfileFields
              value={academicProfile}
              onChange={setAcademicProfile}
              includeTeachingAssignment={role === "HOD"}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
