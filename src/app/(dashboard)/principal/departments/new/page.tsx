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
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { FMSUser } from "@/types";

export default function NewDepartmentPage() {
  const router = useRouter();
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/college/users?role=HOD")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setHods(d.users ?? []))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", code: "", hodUid: "" },
  });

  const onSubmit = async (data: DepartmentFormData) => {
    setIsSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === data.hodUid);
      const payload = {
        name: data.name,
        code: data.code.toUpperCase(),
        hodUid: data.hodUid ?? "",
        hodName: selectedHod?.name ?? "",
      };
      const res = await fetch("/api/college/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department added" });
      router.push("/principal/departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Department"
        description="Add a new department and optionally assign a Head of Department"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dept-name">Department Name *</Label>
              <Input
                id="dept-name"
                {...register("name")}
                placeholder="e.g. Computer Science"
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dept-code">Short Code *</Label>
              <Input
                id="dept-code"
                {...register("code")}
                placeholder="e.g. CS"
                className="uppercase"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">2-10 uppercase letters, used in reports and batch IDs</p>
              {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Assign HOD</Label>
              {hods.length > 0 ? (
                <Select onValueChange={(v) => setValue("hodUid", v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select HOD (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No HOD —</SelectItem>
                    {hods.map((h) => (
                      <SelectItem key={h.uid} value={h.uid}>
                        {h.name} {h.department ? `(${h.department})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No HODs yet — create an HOD account first
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add Department</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
