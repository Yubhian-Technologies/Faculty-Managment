"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STUDENT_PASSWORD_MIN_LENGTH, studentPasswordError } from "@/lib/students/passwordPolicy";
import { RosterFormFields } from "@/components/students/RosterFieldInputs";
import { fetchRosterFormMetadata } from "@/lib/students/rosterFormMetadata";
import { freshmanPickerDepartmentNames, isValidYear1LandingDepartment, type DepartmentWithId } from "@/lib/college/academicStructure";
import { EDITABLE_ROSTER_FIELDS, rosterFieldFormValue, rosterFormToPayload } from "@/lib/students/rosterFields";
import { toast } from "@/hooks/useToast";
import { editFieldLabel, fieldErrorMap, problemsFromResponse, savedSummary, type EditProblem, type EditSaveResponse } from "@/lib/students/editFormResult";
import type { Department, Course, StudentListItem, StudentRecord } from "@/types";

type RosterForm = Record<string, string>;

const EMPTY_FORM: RosterForm = Object.fromEntries(EDITABLE_ROSTER_FIELDS.map((f) => [f.key, ""]));

/**
 * The fields shown read-only (disabled) in the form. Add: none. Edit: Department and
 * Year always (moving a student is the sectioning/promotion flow's job), and the
 * Roll No unless this is the College Office's form (`rollEditable`). Course too when `courseLocked`: a student who is
 * already in a section keeps that section's course (moving them is the sectioning flow's job, not this form's).
 */
export function lockedFieldKeys(isEdit: boolean, rollEditable: boolean, courseLocked = false): string[] {
  if (!isEdit) return [];
  const base = rollEditable ? ["department", "year"] : ["rollNumber", "department", "year"];
  return courseLocked ? [...base, "course"] : base;
}

interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The student being edited - omit/null to add a new one. */
  student?: StudentListItem | StudentRecord | null;
  onSaved: () => void;
  /**
   * Edit only: let the Roll No be changed (instead of the read-only box every other
   * role sees). Passed by the College Office pages alone - the server applies the
   * same rule by role, so this only decides whether the field is unlocked.
   */
  rollEditable?: boolean;
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
export function StudentFormDialog({ open, onOpenChange, student, onSaved, rollEditable = false }: StudentFormDialogProps) {
  const editTarget = student ?? null;
  // A student already in a section keeps that section's course (the server refuses a different one), so the box is
  // locked with the reason - but only while they have a course to show (a legacy blank one must stay fillable).
  const courseLocked = !!editTarget && !!editTarget.section?.trim() && !!(editTarget.course ?? "").trim();
  const [form, setForm] = useState<RosterForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Add only. Optional: when typed, the student's login is created with exactly
  // this password. It is sent once and never stored or shown again.
  const [loginPassword, setLoginPassword] = useState("");
  // What the last save refused: by field (shown under that box) and as one list (shown at the top). They stay until
  // the person edits the field again or saves again - unlike a toast, which disappears by itself.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<EditProblem[]>([]);
  // A refusal that names no field (a network or server error, or an Add that failed).
  const [formError, setFormError] = useState("");

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
      setLoginPassword("");
      setFieldErrors({});
      setProblems([]);
      setFormError("");
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

  // Editing a box clears the reason the last save gave for THAT box (the rest stay until the next save).
  function setF(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setProblems((prev) => prev.filter((p) => p.field !== key));
    }
  }

  const activeDepartments = departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name));

  // Shows what a save refused: under each box, as one list at the top, and in a toast. Scrolls to the first one.
  function showProblems(list: EditProblem[], headline?: string) {
    setProblems(list);
    setFieldErrors(fieldErrorMap(list));
    setFormError("");
    toast({ variant: "destructive", title: headline ?? (list.length === 1 ? list[0].message : `${list.length} fields need attention - nothing was saved`) });
    setTimeout(() => {
      const target = document.querySelector("[data-field-error]") ?? document.getElementById("student-edit-problems");
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }

  async function handleSave() {
    const found: EditProblem[] = [];
    const need = (field: string, message: string) => found.push({ field, label: editFieldLabel(field), message });
    // Roll No is optional on Add - the Office often enrols students before roll numbers exist and sets them later.
    // Student Mobile No is required (and unique across every college - the server checks that): on Add it must be
    // filled in; on Edit an existing number can be corrected but not removed (a legacy student with none may be saved
    // without one until it is entered).
    if (!editTarget && !form.mobileNo?.trim()) need("mobileNo", "Student Mobile No is required");
    if (editTarget && !form.mobileNo?.trim() && editTarget.mobileNo?.trim()) {
      need("mobileNo", "A student's Student Mobile No can't be removed - change it to the correct number instead");
    }
    // Edit with an editable Roll No: an existing roll can be corrected, never emptied
    // (the server refuses it too). A legacy roll-less student may still be saved blank.
    if (editTarget && rollEditable && !form.rollNumber?.trim() && editTarget.rollNumber?.trim()) {
      need("rollNumber", "A student's Roll No can't be removed - change it to the correct number instead");
    }
    if (!form.name?.trim()) need("name", "Name is required");
    if (!form.course) need("course", "Course is required");
    if (!form.department) need("department", "Department is required");
    if (!form.year) need("year", "Academic Year is required");
    // Add only - department/year aren't editable via this form on Edit (see
    // readOnlyKeys below). A 1st-year student at a college that runs a shared
    // first year must land under a Basic Science (Freshman) department with a
    // Core Department named - same rule RosterFieldInputs already steers the
    // pickers toward and the server enforces on submit.
    if (!editTarget && form.year === "1" && form.department) {
      const freshmanNames = freshmanPickerDepartmentNames(departments as DepartmentWithId[]);
      if (!isValidYear1LandingDepartment(departments as DepartmentWithId[], freshmanNames, form.department)) {
        need("department", `"${form.department}" is a real branch - set it as Core Department instead of Department for a 1st Year student`);
      } else if (freshmanNames.has(form.department) && !form.secondaryDepartment) {
        need("secondaryDepartment", "Core Department is required for 1st Year students");
      }
    }

    if (!editTarget && loginPassword) {
      const problem = studentPasswordError(loginPassword);
      if (problem) need("loginPassword", problem);
    }
    if (found.length > 0) { showProblems(found); return; }

    setFieldErrors({});
    setProblems([]);
    setFormError("");
    setSaving(true);
    try {
      // On Edit, a blank field must overwrite (clear) whatever the student
      // currently has - not be silently dropped as if never provided.
      const payload = rosterFormToPayload(form, { writeBlanksAsNull: !!editTarget });
      // Editing sends the detail fields and the name. Department/year are sent only so the server can see they are
      // unchanged - moving a student between departments or years is the promotion/section flow's job.
      const res = editTarget
        ? await fetch(`/api/college/students/${editTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ details: payload }),
          })
        : await fetch("/api/college/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(loginPassword ? { ...payload, loginPassword } : payload),
          });
      const json = await res.json() as EditSaveResponse & { id?: string; loginCreated?: boolean; loginError?: string };
      if (!res.ok) {
        const list = problemsFromResponse(json);
        if (list.length > 0) {
          showProblems(list, json.error);
        } else {
          // Nothing names a field (Add, or a refusal such as "Outside your department"): kept in the dialog.
          const message = json.error ?? (editTarget ? "Failed to save changes" : "Failed to add student");
          setFormError(message);
          toast({ variant: "destructive", title: message });
          setTimeout(() => document.getElementById("student-edit-problems")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
        }
        return;
      }
      const savedText = editTarget ? savedSummary(json.saved) : "";
      toast({
        variant: "success",
        title: `${form.name.trim()} ${editTarget ? "updated" : "added"}${json.loginCreated ? " - login created" : ""}`,
        ...(editTarget ? { description: savedText ? `Saved: ${savedText}` : "Nothing needed changing" } : {}),
      });
      if (json.ignored && json.ignored.length > 0) {
        toast({ variant: "destructive", title: "Left as it was", description: json.ignored.map((i) => `${i.label}: ${i.message}`).join(" ") });
      }
      if (json.loginCreated === false) {
        toast({ variant: "destructive", title: "The student was added, but the login was not created", description: json.loginError });
      }
      onOpenChange(false);
      onSaved();
    } catch {
      setFormError("Network error - please try again");
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

        {(problems.length > 0 || formError) && (
          <div id="student-edit-problems" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium text-destructive">
              {editTarget ? "Nothing was saved - fix the following and save again" : "The student was not added"}
            </p>
            {problems.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {problems.map((p) => <li key={p.field}>{p.message}</li>)}
              </ul>
            ) : (
              <p className="mt-1">{formError}</p>
            )}
          </div>
        )}

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
            // students/[id] PATCH refuses a different one (moving a student is
            // the sectioning/promotion flow's job), and leaving them as live
            // Selects let an office user click a different department and have
            // its side effect of clearing Secondary Department (and Course when
            // it no longer matches) - a confusing partial change. Locking them
            // stops that click from happening at all. Course is locked too for
            // a student already in a section: their course follows the section.
            readOnlyKeys={lockedFieldKeys(!!editTarget, rollEditable, courseLocked)}
            readOnlyCaptions={courseLocked ? { course: `${editTarget?.name ?? "This student"} is in section ${editTarget?.section} - a student's course follows their section. To change it, move them to a section of the other course (Sectioning).` } : undefined}
            errors={fieldErrors}
          />
        )}

        {!editTarget && !isLoadingMeta && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label htmlFor="new-student-login-password">Login password (optional)</Label>
            <Input
              id="new-student-login-password"
              type="password"
              autoComplete="new-password"
              value={loginPassword}
              onChange={(e) => {
                setLoginPassword(e.target.value);
                if (fieldErrors.loginPassword) {
                  setFieldErrors((prev) => { const next = { ...prev }; delete next.loginPassword; return next; });
                  setProblems((prev) => prev.filter((p) => p.field !== "loginPassword"));
                }
              }}
              placeholder={`Leave blank to create the login later - at least ${STUDENT_PASSWORD_MIN_LENGTH} characters`}
              aria-invalid={fieldErrors.loginPassword ? true : undefined}
            />
            {fieldErrors.loginPassword && <p role="alert" data-field-error="loginPassword" className="text-xs font-medium text-destructive">{fieldErrors.loginPassword}</p>}
            <p className="text-xs text-muted-foreground">
              When given, the student can sign in with their Roll Number and this password straight away. It is not saved anywhere readable, and they can change it after signing in.
            </p>
          </div>
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
