"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCollegeSchema, type CreateCollegeFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";

export default function NewCollegePage() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCollegeFormData>({
    resolver: zodResolver(createCollegeSchema),
  });

  const onSubmit = async (data: CreateCollegeFormData) => {
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json() as { collegeId?: string; error?: string };

      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create college", description: json.error });
        return;
      }

      toast({ variant: "success", title: "College created", description: `ID: ${json.collegeId}` });
      router.push("/super-admin/colleges");
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Please try again." });
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add College"
        description="Register a new institution in the system"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">College Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">College Name *</Label>
              <Input
                id="name"
                {...register("name")}
                placeholder="e.g. St. Xavier's College of Engineering"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                {...register("address")}
                placeholder="City, State"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  {...register("contactEmail")}
                  placeholder="admin@college.edu"
                />
                {errors.contactEmail && (
                  <p className="text-sm text-destructive">{errors.contactEmail.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">Contact Phone</Label>
                <Input
                  id="contactPhone"
                  {...register("contactPhone")}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Create College
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
