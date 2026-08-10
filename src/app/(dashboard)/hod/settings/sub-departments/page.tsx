"use client";

import { useEffect, useState, useCallback } from "react";
import { Network, Plus, Users, BookMarked, UserCog, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CreateHodDialog } from "@/components/college/CreateHodDialog";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import type { Department, FMSUser, Section, StudentListItem } from "@/types";

interface SubDeptSummary {
  dept: Department;
  studentCount: number;
  sectionCount: number;
}

export default function SubDepartmentsSettingsPage() {
  const user = useAuthStore((s) => s.user);
  // A local primitive, not `user.department` inline in the closure below -
  // useAuth's onIdTokenChanged legitimately re-fires (producing a new `user`
  // object reference) shortly after initial sign-in even when nothing
  // relevant changed, which was retriggering the whole load a second time
  // and causing a loading -> loaded -> loading flicker. Referencing `user`
  // directly inside the callback also defeats the React Compiler's own
  // dependency inference (it sees the whole object as read), so this needs
  // to be its own variable, not just a narrower useCallback dependency array.
  const department = user?.department;
  const [ownDept, setOwnDept] = useState<Department | null>(null);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [children, setChildren] = useState<SubDeptSummary[]>([]);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [hodUid, setHodUid] = useState("");
  const [managedDepartments, setManagedDepartments] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [editTarget, setEditTarget] = useState<Department | null>(null);
  const [editHodUid, setEditHodUid] = useState("");
  const [editManagedDepartments, setEditManagedDepartments] = useState<string[]>([]);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!department) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [deptsRes, sectionsRes, studentsRes, hodsRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: (Section & { id: string })[] }>),
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentListItem[] }>),
        fetch("/api/college/users?role=HOD&allDepts=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
      ]);

      const departments = deptsRes.departments ?? [];
      const mine = departments.find((d) => d.name === department) ?? null;
      setOwnDept(mine);
      setAllDepartments(departments);
      setHods(hodsRes.users ?? []);

      if (mine) {
        const childDepts = departments.filter((d) => d.parentDepartmentId === mine.id);
        const sections = sectionsRes.sections ?? [];
        const students = studentsRes.students ?? [];
        setChildren(
          childDepts.map((dept) => ({
            dept,
            studentCount: students.filter((s) => s.department === dept.name).length,
            sectionCount: sections.filter((s) => s.department === dept.name).length,
          }))
        );
      } else {
        setChildren([]);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load sub-departments" });
    } finally {
      setIsLoading(false);
    }
  }, [department]);

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
        await load();
    })();
  }, [load]);

  function resetForm() {
    setName("");
    setCode("");
    setHodUid("");
    setManagedDepartments([]);
  }

  function toggleManagedDepartment(deptName: string, checked: boolean) {
    setManagedDepartments((prev) => (checked ? [...prev, deptName] : prev.filter((n) => n !== deptName)));
  }

  async function handleHodCreated(uid: string) {
    const res = await fetch("/api/college/users?role=HOD&allDepts=true");
    const data = await res.json() as { users: FMSUser[] };
    setHods(data.users ?? []);
    setHodUid(uid);
  }

  async function handleAddSubDepartment() {
    if (!ownDept) return;
    if (!name.trim() || !code.trim()) {
      toast({ variant: "destructive", title: "Name and code are required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === hodUid);
      const res = await fetch("/api/college/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.toUpperCase().trim(),
          hodUid: hodUid || "",
          hodName: selectedHod?.name ?? "",
          parentDepartmentId: ownDept.id,
          managedDepartments: managedDepartments.length > 0 ? managedDepartments : undefined,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add sub-department");

      toast({ variant: "success", title: "Sub-department added" });
      setDialogOpen(false);
      resetForm();
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add sub-department" });
    } finally {
      setIsSubmitting(false);
    }
  }

  function openEditDialog(dept: Department) {
    setEditTarget(dept);
    setEditHodUid(dept.hodUid ?? "");
    setEditManagedDepartments(dept.managedDepartments ?? []);
  }

  function toggleEditManagedDepartment(deptName: string, checked: boolean) {
    setEditManagedDepartments((prev) => (checked ? [...prev, deptName] : prev.filter((n) => n !== deptName)));
  }

  async function handleEditHodCreated(uid: string) {
    const res = await fetch("/api/college/users?role=HOD&allDepts=true");
    const data = await res.json() as { users: FMSUser[] };
    setHods(data.users ?? []);
    setEditHodUid(uid);
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setIsEditSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === editHodUid);
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deptId: editTarget.id,
          hodUid: editHodUid || "",
          hodName: editHodUid ? (selectedHod?.name ?? "") : "",
          managedDepartments: editManagedDepartments,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update sub-department");

      toast({ variant: "success", title: "Sub-department updated" });
      setEditTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update sub-department" });
    } finally {
      setIsEditSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/departments?deptId=${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");

      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete" });
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sub-Departments" description="Loading…" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  // Sub-departments are one level deep only - a sub-department can never
  // have sub-departments of its own, so a Sub-HOD landing here (e.g. a stale
  // link, since the nav hides this for them) gets a message that actually
  // applies to them, not the "ask your Principal to enable it" one meant for
  // a plain top-level department.
  if (ownDept?.parentDepartmentId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Sub-Departments"
          description="Split your department into sub-branches, each with its own HOD"
        />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Not available for a sub-department"
              description="Sub-departments are one level deep only - your department can't be split further."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ownDept?.hasSubDepartments) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Sub-Departments"
          description="Split your department into sub-branches, each with its own HOD"
        />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Sub-departments aren't enabled for your department"
              description="Ask your Principal to enable sub-departments for your department before you can add sub-departments and assign sub-HODs."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sub-Departments"
        description={`Add sub-departments under ${ownDept.name}, assign each its own Sub-HOD, and group whole branches under them - the Sub-HOD then fully manages those branches' students and sections.`}
        actions={
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Sub-Department</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Sub-Department</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. BSM"
                    className="uppercase"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Assign Sub-HOD</Label>
                    <CreateHodDialog department={name || undefined} onCreated={handleHodCreated} />
                  </div>
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
                      No HODs yet - create one above
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground rounded-md border p-2.5">
                  This Sub-HOD gets full edit rights (overview, sections, assign faculty) over{" "}
                  <strong className="text-foreground">{name || "this sub-department"}</strong> and every department
                  grouped under it below.
                </p>
                <div className="space-y-2">
                  <Label>Managed Departments</Label>
                  {(() => {
                    const options = allDepartments.filter(
                      (d) => !d.parentDepartmentId && d.name !== ownDept.name && d.name !== name
                    );
                    return options.length > 0 ? (
                      <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                        {options.map((d) => (
                          <label key={d.id} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={managedDepartments.includes(d.name)}
                              onCheckedChange={(checked) => toggleManagedDepartment(d.name, !!checked)}
                            />
                            {d.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                        No other top-level departments yet
                      </p>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground">
                    Optional - group whole branches (e.g. IT and CSBS) under this sub-department. Its Sub-HOD then gets
                    full control of those branches&apos; students, sections, and academics - so they can create
                    sections and divide students across them.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => void handleAddSubDepartment()} loading={isSubmitting}>Add Sub-Department</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {children.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="No sub-departments yet"
              description="Add your first sub-department to split this department into sub-branches, each run by its own Sub-HOD."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.map(({ dept, studentCount, sectionCount }) => (
            <Card key={dept.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{dept.name}</p>
                    <Badge variant="secondary" className="text-xs mt-1">{dept.code}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditDialog(dept)}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
                      title="Edit Sub-HOD and grouped departments"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(dept)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-destructive"
                      title="Delete sub-department"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
                  {dept.hodName
                    ? <span><strong>{dept.hodName}</strong> - Sub-HOD</span>
                    : <span className="text-muted-foreground italic">No Sub-HOD assigned</span>}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 shrink-0" />
                  <span><strong className="text-foreground">{studentCount}</strong> students</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookMarked className="h-4 w-4 shrink-0" />
                  <span><strong className="text-foreground">{sectionCount}</strong> sections</span>
                </div>
                {dept.managedDepartments && dept.managedDepartments.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Manages <span className="text-foreground">{dept.managedDepartments.join(", ")}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              Name and code can only be changed by your Principal. You can reassign the Sub-HOD and change which
              branches this sub-department manages here.
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Assign Sub-HOD</Label>
                <CreateHodDialog department={editTarget?.name} onCreated={handleEditHodCreated} />
              </div>
              {hods.length > 0 ? (
                <Select value={editHodUid || "none"} onValueChange={(v) => setEditHodUid(v === "none" ? "" : v)}>
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
                  No HODs yet - create one above
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Managed Departments</Label>
              {(() => {
                const options = allDepartments.filter(
                  (d) => !d.parentDepartmentId && d.name !== ownDept?.name && d.name !== editTarget?.name
                );
                return options.length > 0 ? (
                  <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                    {options.map((d) => (
                      <label key={d.id} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={editManagedDepartments.includes(d.name)}
                          onCheckedChange={(checked) => toggleEditManagedDepartment(d.name, !!checked)}
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                    No other top-level departments yet
                  </p>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                {editTarget?.name ?? "This sub-department"}&apos;s Sub-HOD fully manages the branches checked here -
                e.g. group IT and CSBS so the Sub-HOD can see all their students, create sections, and divide students
                across them.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveEdit()} loading={isEditSubmitting}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name ?? ""}?`}
        description={`This removes ${deleteTarget?.name ?? "this sub-department"} and its Sub-HOD assignment. It can only be deleted while it has no students or sections.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
