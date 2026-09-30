"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RosterFormFields } from "@/components/students/RosterFieldInputs";
import { fetchRosterFormMetadata } from "@/lib/students/rosterFormMetadata";
import { freshmanPickerDepartmentNames, type DepartmentWithId } from "@/lib/college/academicStructure";
import { EDITABLE_ROSTER_FIELDS, rosterFieldFormValue, rosterFormToPayload } from "@/lib/students/rosterFields";
import { toast } from "@/hooks/useToast";
import type { Department, Course, StudentListItem, StudentRecord } from "@/types";

type RosterForm = Record<string, string>;

const EMPTY_FORM: RosterForm = Object.fromEntries(EDITABLE_ROSTER_FIELDS.map((f) => [f.key, ""]));

interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The student being edited - omit/null to add a new one. */
  student?: StudentListItem | StudentRecord | null;
  onSaved: () => void;
}

/**
 * The Add/Edit Student dialog - the single canonical implementation, shared
 * by the College Office Students list (both Add and Edit) and the read-only
 * Student profile page's own Edit button, so there's exactly one place this
 * form's fields, validation and save request are defined. Loads its own
 * Course/Department/Academic Year picker data fresh whenever it opens
 * (fetchRosterFormMetadata) rather than requiring every caller to already
 * have it loaded, the same "self-contained, works from any page" shape as
 * StudentDetailsPage itself.
 */
export function StudentFormDialog({ open, onOpenChange, student, onSaved }: StudentFormDialogProps) {
  const editTarget = student ?? null;
  const [form, setForm] = useState<RosterForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courseNames, setCourseNames] = useState<string[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);

  // Wrapped so none of these setState calls are reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    void (async () => {
      setForm(
        editTarget
          ? (Object.fromEntries(EDITABLE_ROSTER_FIELDS.map((f) => [f.key, rosterFieldFormValue(f, editTarget)])) as RosterForm)
          : EMPTY_FORM
      );
      setIsLoadingMeta(true);
      try {
        const meta = await fetchRosterFormMetadata();
        setDepartments(meta.departments);
        setCourseNames(meta.courseNames);
        setCourses(meta.courses);
        setYears(meta.years);
      } catch {
        toast({ variant: "destructive", title: "Failed to load form options" });
      } finally {
        setIsLoadingMeta(false);
      }
    })();
    // editTarget is an object identity that changes on every parent render -
    // keying off open (and the id it belongs to) avoids re-seeding the form
    // on every re-render while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget?.id]);

  function setF(key: string, value: string) { setForm((f) => ({ ...f, [key]: value })); }

  const activeDepartments = departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name));

  async function handleSave() {
    // Roll No is the student's unique identity - required on Add. (On Edit it
    // is shown read-only, so a legacy roll-less student can still be edited.)
    if (!editTarget && !form.rollNumber?.trim()) { toast({ variant: "destructive", title: "Roll No is required" }); return; }
    if (!form.name?.trim()) { toast({ variant: "destructive", title: "Name is required" }); return; }
    if (!form.course) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.department) { toast({ variant: "destructive", title: "Department is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Academic Year is required" }); return; }
    // Add only - department/year aren't editable via this form on Edit (see
    // readOnlyKeys below). A 1st-year student at a college that runs a shared
    // first year must land under a Basic Science (Freshman) department with a
    // Core Department named - same rule RosterFieldInputs already steers the
    // pickers toward and the server enforces on submit.
    if (!editTarget && form.year === "1") {
      const freshmanNames = freshmanPickerDepartmentNames(departments as DepartmentWithId[]);
      if (freshmanNames.size > 0 && !freshmanNames.has(form.department)) {
        toast({ variant: "destructive", title: `"${form.department}" is a real branch - set it as Core Department instead of Department for a 1st Year student` });
        return;
      }
      if (freshmanNames.size > 0 && !form.secondaryDepartment) {
        toast({ variant: "destructive", title: "Core Department is required for 1st Year students" });
        return;
      }
    }

    setSaving(true);
    try {
      // On Edit, a blank field must overwrite (clear) whatever the student
      // currently has - not be silently dropped as if never provided.
      const payload = rosterFormToPayload(form, { writeBlanksAsNull: !!editTarget });
      // Editing sends only the detail fields - name/department/year stay as
      // they are, since moving a student between departments or years is the
      // promotion/section flow's job, not a field edit.
      const res = editTarget
        ? await fetch(`/api/college/students/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ details: payload }),
          })
        : await fetch("/api/college/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? (editTarget ? "Failed to save changes" : "Failed to add student") });
        return;
      }
      toast({ variant: "success", title: `${form.name.trim()} ${editTarget ? "updated" : "added"}` });
      onOpenChange(false);
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editTarget ? `Edit ${editTarget.name}` : "Add Student"}</DialogTitle>
          <DialogDescription>
            {editTarget
              ? "The same fields as the roster import. Department and Academic Year are shown for context - moving a student between them is done through sectioning and promotion, not here."
              : "The same fields as the roster import. The student is added as unassigned - the department assigns their section later."}
          </DialogDescription>
        </DialogHeader>

        {isLoadingMeta ? (
          <div className="space-y-3 py-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />)}
          </div>
        ) : (
          <RosterFormFields
            values={form}
            onChange={setF}
            departments={activeDepartments}
            courseNames={courseNames}
            courses={courses}
            years={years}
            // Department and Year are read-only on Edit to match what this
            // dialog's own description already promises ("shown for context") -
            // students/[id] PATCH's roster-detail-edit path silently drops both
            // (see ROSTER_DETAIL_KEYS), so leaving them as live Selects let an
            // office user click a different department and, on Save, have that
            // click silently discarded while its side effect of clearing
            // Secondary Department (and Course when it no longer matches) was
            // NOT discarded - a confusing partial save. Locking them stops that
            // click from happening at all.
            readOnlyKeys={editTarget ? ["rollNumber", "department", "year"] : []}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={isLoadingMeta}>
            {editTarget ? "Save Changes" : "Add Student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
