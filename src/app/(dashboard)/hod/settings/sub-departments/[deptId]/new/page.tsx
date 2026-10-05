"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Network, Plus } from "lucide-react";
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
import {
  buildManagedBranchOwner,
  replaceNoOwnSectionsParents,
  departmentRunsOwnSections,
  type DepartmentWithId,
} from "@/lib/college/academicStructure";
import type { Department, FMSUser } from "@/types";

// Adding a sub-department used to happen in a dialog on the list page
// (hod/settings/sub-departments). It is a real form - name, code, a Sub-HOD and
// the branch grouping - and squeezing it into a dialog left it cramped and easy
// to dismiss by accident, so it gets its own page under the parent it is being
// created under. The API is deliberately unchanged: this is still the ordinary
// college-departments POST, scoped by parentDepartmentId, and the server
// re-checks that this HOD owns that parent and that the parent has
// sub-departments enabled (src/app/api/college/departments/route.ts).

const LIST_HREF = "/hod/settings/sub-departments";

export default function NewSubDepartmentPage() {
  const { deptId } = useParams<{ deptId: string }>();
  const router = useRouter();

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
      setAllDepartments(deptsRes.departments ?? []);
      // A RESIGNED/RETIRED person (flagged by the API in read-only-access colleges) can no longer be a Sub-HOD.
      setHods((hodsRes.users ?? []).filter((u) => !u.facultyExited));
    } catch {
      toast({ variant: "destructive", title: "Failed to load sub-departments" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
      await load();
    })();
  }, [load]);

  const ownDept = useMemo(
    () => allDepartments.find((d) => d.id === deptId) ?? null,
    [allDepartments, deptId]
  );

  // branch name -> the sub-department already managing it. A branch may be
  // grouped under only ONE sub-department (enforced with a 409 by
  // college/departments); showing it disabled here means the user never picks a
  // branch that is going to be rejected. Same helper the server uses.
  const branchOwner = useMemo(
    () => buildManagedBranchOwner(allDepartments as DepartmentWithId[]),
    [allDepartments]
  );

  // What this new sub-department may be given to manage: the branches the
  // PRINCIPAL cross-listed on this parent department (its Core Departments),
  // which is exactly what this page is for - dividing the parent's own branches
  // among its sub-departments. Falls back to every top-level department when the
  // Principal has set no Core Departments at all, so a college that never
  // configured cross-listing still works. Either way a department that runs no
  // sections of its own is excluded - it can hold neither sections nor students,
  // so managing it is meaningless (its children are listed in its place).
  const manageableBranches = useMemo(() => {
    if (!ownDept) return [];
    const configured = replaceNoOwnSectionsParents(
      allDepartments as DepartmentWithId[],
      ownDept.secondaryDepartments ?? []
    );
    const pool =
      configured.length > 0
        ? configured
            .map((n) => allDepartments.find((d) => d.name === n))
            .filter((d): d is Department => Boolean(d))
        : allDepartments.filter((d) => !d.parentDepartmentId);
    return pool.filter((d) => d.name !== ownDept.name && departmentRunsOwnSections(d));
  }, [allDepartments, ownDept]);

  const branchOptions = manageableBranches.filter((d) => d.name !== name);
  const listHref = `${LIST_HREF}?dept=${encodeURIComponent(ownDept?.name ?? "")}`;

  function toggleManagedDepartment(deptName: string, checked: boolean) {
    setManagedDepartments((prev) => (checked ? [...prev, deptName] : prev.filter((n) => n !== deptName)));
  }

  async function handleAddSubDepartment(e: React.FormEvent) {
    e.preventDefault();
    if (!ownDept) return;
    if (!name.trim() || !code.trim()) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.toUpperCase().trim(),
          parentDepartmentId: ownDept.id,
          managedDepartments: managedDepartments.length > 0 ? managedDepartments : undefined,
        }),
      });
      const json = (await res.json()) as { error?: string; deptId?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add sub-department");

      // The sub-department comes with its own HOD seat; put the chosen faculty
      // member in it.
      if (hodUid && json.deptId) {
        const seatRes = await fetch("/api/college/departments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId: json.deptId, hodUid }),
        });
        if (!seatRes.ok) {
          const seatJson = (await seatRes.json()) as { error?: string };
          toast({
            variant: "destructive",
            title: "Sub-department added, but the Sub-HOD wasn't appointed",
            description: seatJson.error,
          });
        }
      }

      toast({ variant: "success", title: "Sub-department added" });
      router.push(listHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add sub-department" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Add Sub-Department" description="Loading…" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  // Sub-departments are one level deep only, and a parent has to have had
  // sub-departments switched on by the Principal first. Both are enforced by
  // the server too - this is just the page saying why instead of offering a
  // form that would be rejected on submit.
  if (!ownDept) {
    return (
      <div className="space-y-6">
        <PageHeader title="Add Sub-Department" description="Create a sub-department under your department" />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Department not found"
              description="It may have been removed, or it isn't a department you head."
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

  if (ownDept.parentDepartmentId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Add Sub-Department" description={`Under ${ownDept.name}`} />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Not available for a sub-department"
              description="Sub-departments are one level deep only - your department can't be split further."
              icon={<Network className="h-8 w-8" />}
              action={
                <Button asChild variant="outline">
                  <Link href={listHref}>Back to Sub-Departments</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ownDept.hasSubDepartments) {
    return (
      <div className="space-y-6">
        <PageHeader title="Add Sub-Department" description={`Under ${ownDept.name}`} />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Sub-departments aren't enabled for your department"
              description="Ask your Principal to enable sub-departments for your department before you can add sub-departments and assign sub-HODs."
              icon={<Network className="h-8 w-8" />}
              action={
                <Button asChild variant="outline">
                  <Link href={listHref}>Back to Sub-Departments</Link>
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
        title="Add Sub-Department"
        description={`Add a sub-department under ${ownDept.name}, assign it its own Sub-HOD, and group whole branches under it - the Sub-HOD then fully manages those branches' students and sections.`}
      />

      <form onSubmit={handleAddSubDepartment} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sub-Department Details</CardTitle>
            <CardDescription>
              It sits under {ownDept.name} and shows up in Role Assignments as its own HOD seat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subdept-name">Sub-Department Name *</Label>
              <Input
                id="subdept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. ${ownDept.name} - Mathematics`}
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
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sub-HOD</CardTitle>
            <CardDescription>
              Optional - a Sub-HOD is a seat a person holds on top of their own faculty login, not a separate
              account. You can appoint one later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hods.length > 0 ? (
              <Select value={hodUid || "none"} onValueChange={(v) => setHodUid(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Sub-HOD (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- No Sub-HOD -</SelectItem>
                  {hods.map((h) => (
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
                  const takenBy = branchOwner.get(d.name);
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
            <Plus className="h-4 w-4 mr-2" />
            Add Sub-Department
          </Button>
        </div>
      </form>
    </div>
  );
}
