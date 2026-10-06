"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Network, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import {
  buildManagedBranchOwner,
  replaceNoOwnSectionsParents,
  departmentRunsOwnSections,
  type DepartmentWithId,
} from "@/lib/college/academicStructure";
import type { Department, FMSUser } from "@/types";

// Editing a sub-department used to open a cramped dialog on the list page while Adding one had its own page.
// Same form, same cards, same wording as hod/settings/sub-departments/[deptId]/new - only pre-filled. `deptId` here
// is the SUB-department being edited (on the Add page it is the parent). The API is the ordinary college-departments
// PATCH; the server re-checks that this HOD owns the parent, that only the Head of Department renames / recodes it,
// and that the name / code are unique. Name and code are only sent when they actually changed.

const LIST_HREF = "/hod/settings/sub-departments";

export default function EditSubDepartmentPage() {
  const { deptId } = useParams<{ deptId: string }>();
  const router = useRouter();
  // A Department Office head reads as HOD everywhere, but appointing / renaming stays with the actual HOD.
  const isDepartmentOfficeHead = useAuthStore((s) => s.user?.realRole === "DEPARTMENT_OFFICE");

  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [hodUid, setHodUid] = useState("");
  const [managedDepartments, setManagedDepartments] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [deptsRes, hodsRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        // A Sub-HOD is a seat held by one of the department's own faculty - not a separate login.
        fetch("/api/college/users?role=PANEL_MEMBER").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
      ]);
      const departments = deptsRes.departments ?? [];
      setAllDepartments(departments);
      setHods(hodsRes.users ?? []);
      const mine = departments.find((d) => d.id === deptId);
      if (mine) {
        setName(mine.name);
        setCode(mine.code ?? "");
        setHodUid(mine.hodUid ?? "");
        // Narrowed for the same reason the list chips are: a grouped department that runs no sections of its own is
        // no longer offered below, so carrying it in state unseen would silently re-save it (and bring the chip back).
        // Its children stand in for it, which is what every reader already resolves it to.
        setManagedDepartments(replaceNoOwnSectionsParents(departments as DepartmentWithId[], mine.managedDepartments ?? []));
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load sub-department" });
    } finally {
      setIsLoading(false);
    }
  }, [deptId]);

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
      await load();
    })();
  }, [load]);

  const subDept = useMemo(() => allDepartments.find((d) => d.id === deptId) ?? null, [allDepartments, deptId]);
  const parentDept = useMemo(
    () => (subDept?.parentDepartmentId ? allDepartments.find((d) => d.id === subDept.parentDepartmentId) ?? null : null),
    [allDepartments, subDept]
  );

  // branch name -> the sub-department already managing it (one owner per branch, enforced with a 409 by the server).
  const branchOwner = useMemo(
    () => buildManagedBranchOwner(allDepartments as DepartmentWithId[]),
    [allDepartments]
  );

  // What this sub-department may manage: the branches the PRINCIPAL cross-listed on its parent (the parent's Core
  // Departments), falling back to every top-level department when none are set - identical to the Add page. A
  // department that runs no sections of its own is excluded (its children are listed in its place).
  const manageableBranches = useMemo(() => {
    if (!parentDept) return [];
    const configured = replaceNoOwnSectionsParents(allDepartments as DepartmentWithId[], parentDept.secondaryDepartments ?? []);
    const pool =
      configured.length > 0
        ? configured.map((n) => allDepartments.find((d) => d.name === n)).filter((d): d is Department => Boolean(d))
        : allDepartments.filter((d) => !d.parentDepartmentId);
    return pool.filter((d) => d.name !== parentDept.name && departmentRunsOwnSections(d));
  }, [allDepartments, parentDept]);

  const branchOptions = manageableBranches.filter((d) => d.name !== subDept?.name && d.name !== name);
  const listHref = `${LIST_HREF}?dept=${encodeURIComponent(parentDept?.name ?? "")}`;

  // Someone who left (RESIGNED/RETIRED) can't be newly appointed - but the person already in the seat stays visible.
  const hodOptions = useMemo(
    () => hods.filter((h) => !h.facultyExited || h.uid === subDept?.hodUid),
    [hods, subDept]
  );

  function toggleManagedDepartment(deptName: string, checked: boolean) {
    setManagedDepartments((prev) => (checked ? [...prev, deptName] : prev.filter((n) => n !== deptName)));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!subDept) return;
    const nextName = name.trim().replace(/\s+/g, " ");
    const nextCode = code.trim().toUpperCase().replace(/\s+/g, "");
    if (!nextName || !nextCode) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    if (nextCode.length > 10) {
      toast({ variant: "destructive", title: "Short code can be at most 10 characters" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deptId: subDept.id,
          // Only sent when changed, so a plain Sub-HOD / grouping save never touches them.
          ...(nextName !== subDept.name ? { name: nextName } : {}),
          ...(nextCode !== (subDept.code ?? "") ? { code: nextCode } : {}),
          hodUid: hodUid || "",
          managedDepartments,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update sub-department");

      toast({ variant: "success", title: "Sub-department updated" });
      router.push(listHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update sub-department" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Sub-Department" description="Loading…" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  // Only a real sub-department can be edited here (a top-level department is edited by the Principal).
  if (!subDept || !parentDept) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit Sub-Department" description="Change a sub-department of your department" />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Sub-department not found"
              description="It may have been removed, or it isn't a sub-department of a department you head."
              icon={<Network className="h-8 w-8" />}
              action={
                <Button asChild variant="outline">
                  <Link href={LIST_HREF}>Back to Sub-Departments</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Edit Sub-Department"
        description={`Change ${subDept.name} under ${parentDept.name}, its Sub-HOD, and the branches it manages. Nothing already filed under it is lost - sections, students and assignments follow the new name.`}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sub-Department Details</CardTitle>
            <CardDescription>
              It sits under {parentDept.name} and shows up in Role Assignments as its own HOD seat.
              {isDepartmentOfficeHead ? " Only the Head of Department can change its name or short code." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subdept-name">Sub-Department Name *</Label>
              <Input
                id="subdept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. ${parentDept.name} - Mathematics`}
                disabled={isDepartmentOfficeHead}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subdept-code">Short Code *</Label>
              <Input
                id="subdept-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. BSM"
                className="uppercase"
                maxLength={10}
                disabled={isDepartmentOfficeHead}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sub-HOD</CardTitle>
            <CardDescription>
              Optional - a Sub-HOD is a seat a person holds on top of their own faculty login, not a separate
              account. You can change it later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hodOptions.length > 0 ? (
              <Select value={hodUid || "none"} onValueChange={(v) => setHodUid(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Sub-HOD (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- No Sub-HOD -</SelectItem>
                  {hodOptions.map((h) => (
                    <SelectItem key={h.uid} value={h.uid}>
                      {h.name} {h.department ? `(${h.department})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                No faculty in your department yet - add faculty first, then appoint one as Sub-HOD
              </p>
            )}
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              This Sub-HOD gets full edit rights (overview, sections, assign faculty) over{" "}
              <strong className="text-foreground">{name || "this sub-department"}</strong> and every department
              grouped under it below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Core Departments</CardTitle>
            <CardDescription>
              Optional - group whole branches (e.g. IT and CSBS) under this sub-department. Its Sub-HOD then gets
              full control of those branches&apos; students, sections, and academics - so they can create sections and
              divide students across them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>Core Departments</Label>
            {branchOptions.length > 0 ? (
              <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                {branchOptions.map((d) => {
                  // A branch this sub-department already manages is its own claim, not a conflict - only another owner disables it.
                  const owner = branchOwner.get(d.name);
                  const takenBy = owner && owner !== subDept.name ? owner : undefined;
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center gap-1.5 text-sm ${takenBy ? "opacity-50" : ""}`}
                      title={takenBy ? `Already a core department of ${takenBy}` : undefined}
                    >
                      <Checkbox
                        disabled={!!takenBy}
                        checked={managedDepartments.includes(d.name)}
                        onCheckedChange={(checked) => toggleManagedDepartment(d.name, !!checked)}
                      />
                      {d.name}
                      {takenBy && <span className="text-xs text-muted-foreground">({takenBy})</span>}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                No branches available - ask your Principal to set this department&apos;s Core Departments.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
          <Button asChild type="button" variant="outline">
            <Link href={listHref}>Cancel</Link>
          </Button>
          <Button type="submit" loading={isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
