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
import { Checkbox } from "@/components/ui/checkbox";
import { CreateHodDialog } from "@/components/college/CreateHodDialog";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { Department, FMSUser } from "@/types";

export default function NewDepartmentPage() {
  const router = useRouter();
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [secondaryDepartments, setSecondaryDepartments] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubDepartments, setHasSubDepartments] = useState(false);
  // Only meaningful when hasSubDepartments is true - see
  // Department.parentRunsOwnSections's own doc-comment (src/types/core.ts).
  // Defaults true: a brand-new department that never touches this checkbox
  // gets the same unrestricted behavior every department had before this
  // field existed.
  const [parentRunsOwnSections, setParentRunsOwnSections] = useState(true);

  useEffect(() => {
    fetch("/api/college/users?role=HOD")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setHods(d.users ?? []))
      .catch(() => {});

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", code: "", hodUid: "" },
  });

  const hodUid = watch("hodUid");
  const nameValue = watch("name");

  async function handleHodCreated(uid: string) {
    try {
      const res = await fetch("/api/college/users?role=HOD");
      const data = await res.json() as { users: FMSUser[] };
      setHods(data.users ?? []);
    } catch {
      toast({ variant: "destructive", title: "Created, but failed to refresh HOD list" });
    }
    setValue("hodUid", uid);
  }

  function toggleSecondaryDepartment(name: string, checked: boolean) {
    setSecondaryDepartments((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  const onSubmit = async (data: DepartmentFormData) => {
    setIsSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === data.hodUid);
      const payload = {
        name: data.name,
        code: data.code.toUpperCase(),
        hodUid: data.hodUid ?? "",
        hodName: selectedHod?.name ?? "",
        hasSubDepartments,
        ...(hasSubDepartments ? { parentRunsOwnSections } : {}),
        secondaryDepartments: secondaryDepartments.length > 0 ? secondaryDepartments : undefined,
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
              <div className="flex items-center justify-between">
                <Label>Assign HOD</Label>
                <CreateHodDialog department={nameValue || undefined} onCreated={handleHodCreated} />
              </div>
              {hods.length > 0 ? (
                <Select
                  value={hodUid || "none"}
                  onValueChange={(v) => setValue("hodUid", v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select HOD (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">- No HOD -</SelectItem>
                    {hods.map((h) => {
                      const hDepts = h.departments && h.departments.length > 0 ? h.departments : (h.department ? [h.department] : []);
                      return (
                        <SelectItem key={h.uid} value={h.uid}>
                          {h.name} {hDepts.length > 0 ? `(${hDepts.join(", ")})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No HODs yet - create one above
                </p>
              )}
              {/* An HOD can now head more than one department at once -
                  picking one who already runs others here ADDS this new
                  department to their portfolio, it never evicts them. */}
              {(() => {
                if (!hodUid) return null;
                const selectedHod = hods.find((h) => h.uid === hodUid);
                const hDepts = selectedHod?.departments && selectedHod.departments.length > 0
                  ? selectedHod.departments
                  : (selectedHod?.department ? [selectedHod.department] : []);
                if (!selectedHod || hDepts.length === 0) return null;
                return (
                  <p className="text-xs text-muted-foreground rounded-md border p-2.5">
                    {selectedHod.name} is already HOD of <strong className="text-foreground">{hDepts.join(", ")}</strong> -
                    saving here adds this new department to their portfolio without removing the rest.
                  </p>
                );
              })()}
            </div>

            <YearsTaughtAndSecondaryFields
              showYears={false}
              assignedYears={[]}
              onToggleYear={() => {}}
              yearsHelperText=""
              // A sub-department can be a valid target too (e.g. feeding
              // "ECE-VLSI" specifically, not just plain ECE) - this new
              // department has no children of its own yet, so nothing to
              // additionally exclude beyond its own (in-progress) name.
              secondaryDepartmentOptions={departments.filter((d) => d.name !== nameValue)}
              secondaryDepartments={secondaryDepartments}
              onToggleSecondaryDepartment={toggleSecondaryDepartment}
            />

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="dept-has-subdepts"
                  checked={hasSubDepartments}
                  onCheckedChange={(v) => setHasSubDepartments(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="dept-has-subdepts" className="font-normal">Has sub-departments</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable if this department splits into sub-branches (e.g. a Freshman&apos;s Department like Basic
                    Science → BS-Maths, BS-English). The HOD will get a &quot;Sub-Departments&quot; page to add
                    sub-departments and assign sub-HODs.
                  </p>
                </div>
              </div>

              {hasSubDepartments && (
                <div className="flex items-start gap-2 ml-6 pt-3 border-t">
                  <Checkbox
                    id="dept-parent-runs-own-sections"
                    checked={parentRunsOwnSections}
                    onCheckedChange={(v) => setParentRunsOwnSections(v === true)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="dept-parent-runs-own-sections" className="font-normal">
                      This department also has its own sections/students, separate from its sub-departments
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Turn this OFF if this department exists only to organize its sub-departments and never
                      enrolls students directly on its own - e.g. a &quot;Basic Science&quot; department whose
                      sub-departments (Maths, Physics, Chemistry, English) are the only place 1st-year students
                      actually sit. Leave it ON if this department itself also runs real sections in addition
                      to its sub-departments - e.g. an &quot;ECE&quot; department that has its own ECE sections
                      AND a further specialized &quot;ECE-VLSI&quot; sub-department with sections of its own.
                    </p>
                  </div>
                </div>
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
