"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { Department } from "@/types";

interface Props {
  hodUid: string;
  hodName: string;
  /** This HOD's current departments (FMSUser.departments, falling back to the one legacy `department`). */
  currentDepartments: string[];
  /** Every top-level department in the college - a sub-department can't be assigned here. */
  topLevelDepartments: Department[];
  onSaved: () => void;
}

// Lets a Principal put one HOD in charge of two or more departments at once,
// in a single save - the explicit counterpart to the per-department "Assign
// HOD" dropdown (principal/departments/[id]/edit), which still works but
// requires repeating the same save once per department. Both write through
// the same additive primitives server-side (college/departments PATCH,
// college/hod-departments PATCH), so picking a department here that another
// HOD currently holds reassigns it to this HOD exactly like the dropdown
// would - the confirmation copy below says so up front instead of surprising
// anyone after the fact.
export function ManageHodDepartmentsDialog({ hodUid, hodName, currentDepartments, topLevelDepartments, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(currentDepartments);
  const [saving, setSaving] = useState(false);

  // Reset the editable set from the event that opens the dialog, not an
  // effect keyed on `open` - the reset only ever needs to happen exactly
  // when the user opens it, never as a reaction to currentDepartments
  // changing while it's already open (that would clobber in-progress edits).
  function handleOpenChange(next: boolean) {
    if (next) setSelected(currentDepartments);
    setOpen(next);
  }

  function toggle(name: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const departmentIds = selected
        .map((name) => topLevelDepartments.find((d) => d.name === name)?.id)
        .filter((id): id is string => !!id);
      const res = await fetch("/api/college/hod-departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hodUid, departmentIds }),
      });
      const json = await res.json() as { error?: string; displaced?: { deptName: string; previousHodName: string }[] };
      if (!res.ok) throw new Error(json.error ?? "Failed to update departments");
      if (json.displaced && json.displaced.length > 0) {
        toast({
          variant: "success",
          title: `${hodName}'s departments updated`,
          description: json.displaced.map((d) => `${d.deptName} moved from ${d.previousHodName}`).join(", "),
        });
      } else {
        toast({ variant: "success", title: `${hodName}'s departments updated` });
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update departments" });
    } finally {
      setSaving(false);
    }
  }

  const takenElsewhere = new Map(
    topLevelDepartments
      .filter((d) => d.hodUid && d.hodUid !== hodUid && d.hodName)
      .map((d) => [d.name, d.hodName as string])
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          <Users className="h-3 w-3 mr-1" />Manage departments
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Departments for {hodName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Check every department {hodName} should run. They keep full HOD access - sections, students, subjects,
            teaching assignments, timetable - across all of them at once. Picking a department someone else
            currently heads reassigns it to {hodName}.
          </p>
          {topLevelDepartments.length > 0 ? (
            <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2 max-h-72 overflow-y-auto">
              {topLevelDepartments.map((d) => {
                const takenBy = takenElsewhere.get(d.name);
                return (
                  <label key={d.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selected.includes(d.name)}
                      onCheckedChange={(checked) => toggle(d.name, !!checked)}
                    />
                    {d.name}
                    {takenBy && <span className="text-xs text-muted-foreground">(currently {takenBy})</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">No departments yet</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
