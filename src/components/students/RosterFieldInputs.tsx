"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  EDITABLE_ROSTER_FIELDS, PRIMARY_ROSTER_FIELDS, DETAIL_ROSTER_FIELDS,
  rosterFieldDisplay, type RosterField,
} from "@/lib/students/rosterFields";
import { resolveDepartmentCourseScope, resolveCatalogId, freshmanLandingDepartmentNames } from "@/lib/college/academicStructure";
import { managerEffectiveYears } from "@/lib/departments/hodScope";
import type { Department, StudentRecord, Course } from "@/types";

// Renders the roster fields for the Office students page - the Add/Edit form
// body and the read-only detail view - straight from the shared spec, so both
// stay in the CSV template's order and wording without restating 35 fields
// in three places.

/** Radix Select rejects "" as an item value, so "not set" needs a sentinel. */
const NONE = "__none__";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/**
 * The programmes `departmentId` can actually register a student into - the
 * distinct names of its OWN Course docs. Unlike Sections (which reference a
 * specific Course doc by id and so can fall back to a shared-year feeder's -
 * see /api/college/courses's departmentId handling), a StudentRecord's
 * `course` is a free-text admissions label with no such fallback to honour:
 * every real branch already owns its own Course doc per programme it
 * actually runs (e.g. every department has its own "Bachelor of
 * Technology"), so direct ownership is the complete, correct answer. This is
 * what keeps, say, Master of Technology out of the Course picker for a
 * department (AIML, CIVIL, ...) that was never given that programme - only
 * the department(s) the Principal actually added it to (see
 * principal/departments/[id]/courses) offer it.
 */
export function courseNamesForDepartment(courses: Course[], departments: Department[], departmentId: string | undefined): string[] {
  if (!departmentId) return [];
  // A sub-department never owns a Course doc of its own - it shares its
  // parent's program (same fallback the server uses for section/course
  // resolution, e.g. api/college/courses's departmentId handling) - so its
  // courses resolve through the parent instead of coming up empty.
  const dept = departments.find((d) => d.id === departmentId);
  const effectiveId = dept?.parentDepartmentId ?? departmentId;
  return Array.from(new Set(
    courses.filter((c) => c.departmentId === effectiveId).map((c) => c.name?.trim()).filter(Boolean) as string[]
  )).sort((a, b) => a.localeCompare(b));
}

/**
 * The reverse of courseNamesForDepartment: departments that actually own a
 * Course doc named `courseName`. Keeps the Department picker from offering a
 * department that never had `courseName` added to it once a course is picked
 * first - the other half of the same constraint. Also offers any sub-department
 * whose PARENT owns the course, for the same reason courseNamesForDepartment
 * falls back to the parent - a shared-first-year sub-department (e.g. "Basic
 * Science - Maths") is a real, selectable Department for a student otherwise.
 */
export function departmentsOfferingCourse(departments: Department[], courses: Course[], courseName: string): Department[] {
  const deptIds = new Set(courses.filter((c) => c.name === courseName).map((c) => c.departmentId));
  return departments.filter((d) => deptIds.has(d.id) || (d.parentDepartmentId != null && deptIds.has(d.parentDepartmentId)));
}

/**
 * The branches a department can register a student into as their Secondary
 * Department - the core branch a 1st-year is bound for while enrolled under a
 * common department. Three things can express that, and a college uses
 * whichever apply: `courseScopes[catalogId].secondaryDepartments` (per-course
 * override - e.g. a department's own independent M.Tech cross-lists no one
 * even though its shared-first-year B.Tech does), the flat
 * `secondaryDepartments` fallback, and the branches grouped under the
 * department or its sub-departments (`managedDepartments`, never course-scoped
 * - see resolveDepartmentCourseScope's own doc-comment for why). Same rollup
 * the Add Section flow uses - without the managed half, a college like Test
 * Engineering (whose Basic Science groups CIVIL/IT/CSE/ECE/EEE through its
 * sub-departments and sets no secondaryDepartments at all) would never see
 * the field.
 *
 * Each raw name collected above is also expanded to its own children (e.g.
 * configuring plain "Artificial Intelligence" as a cross-listed branch
 * implicitly authorizes its sub-departments "AIML"/"AIDS" too, same as
 * "Electronics and Communication Engineering" implicitly covers "ECE-VLSI") -
 * mirrors the backend's isConfiguredSecondaryDepartmentOrChild, which already
 * accepts a child's name typed directly (bulk CSV import, and this form's own
 * unassigned-add submit). Without this expansion, a 1st-year admitted
 * straight into AIML/AIDS/ECE-VLSI/Cyber Security had no dropdown option that
 * actually named their real sub-branch - only the ambiguous parent - even
 * though typing the child's name into a CSV cell already worked.
 */
export function secondaryDepartmentOptions(
  departments: Department[],
  courses: Course[],
  departmentName: string,
  courseName: string
): string[] {
  const own = departments.find((d) => d.name === departmentName);
  if (!own) return [];
  const catalogId = resolveCatalogId(courses, own.id, courseName);
  const names = new Set<string>(resolveDepartmentCourseScope(own, catalogId).secondaryDepartments);
  for (const n of own.managedDepartments ?? []) names.add(n);
  for (const child of departments.filter((d) => d.parentDepartmentId === own.id)) {
    for (const n of child.managedDepartments ?? []) names.add(n);
  }
  const childrenByParentName = new Map<string, string[]>();
  for (const d of departments) {
    if (!d.parentDepartmentId || !d.name) continue;
    const parentName = departments.find((p) => p.id === d.parentDepartmentId)?.name;
    if (!parentName) continue;
    const arr = childrenByParentName.get(parentName);
    if (arr) arr.push(d.name); else childrenByParentName.set(parentName, [d.name]);
  }
  for (const name of Array.from(names)) {
    for (const childName of childrenByParentName.get(name) ?? []) names.add(childName);
  }
  names.delete(departmentName);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * The years a department can register a student into for the chosen course -
 * its "Years Taught" for that specific course when the Principal set a
 * per-course override (Department.courseScopes, e.g. AIDS's independent
 * M.Tech running years 1-2 while its B.Tech runs 2-4), else its flat
 * Department.assignedYears, e.g. a shared-first-year grouping sub-department
 * like BS-CHEMISTRY is set to [1] only, since its later years belong to the
 * branches it feeds (picked via Secondary Department, not by registering the
 * student under BS-CHEMISTRY again). A sub-department an HOD created carries
 * neither of its own (Principal-only override, stripped from anything
 * HOD-created - see college/departments POST) - managerEffectiveYears falls
 * back to its parent's for that case, same as Sections/Teaching
 * Assignments/Timetable already do, so this doesn't fall all the way to
 * fallbackYears just because a sub-department was picked. Falls back to
 * every college-configured year only when NEITHER the department nor its
 * parent has anything set, so a genuinely unconfigured department isn't
 * locked out entirely.
 *
 * When `courseName` is blank (no course chosen yet - e.g. the Students list's
 * own filter bar with "All courses" still selected), catalogId can't be
 * resolved at all - and since Years Taught is now decided PER COURSE
 * (courseScopes), resolving with an undefined catalogId only ever sees the
 * legacy flat field, which most departments (every HOD-created
 * sub-department, in particular) never carry. Left unhandled, that silently
 * fell all the way to `fallbackYears` - every year up to the longest course
 * duration anywhere in scope - for any such department, which is exactly what
 * let a Freshman's Department showing only Year 1 students still offer a
 * "2nd/3rd/4th Year" option once no course was picked. Instead, union this
 * department's own Years Taught across EVERY course it (or, for a
 * sub-department that owns no Course docs of its own, its parent) actually
 * has a catalog entry for, so its real configured years show up regardless of
 * which course ends up chosen.
 */
export function yearOptionsForDepartment(
  departments: Department[],
  courses: Course[],
  departmentName: string,
  courseName: string,
  fallbackYears: number[]
): number[] {
  const dept = departments.find((d) => d.name === departmentName);
  if (!dept) return fallbackYears;

  if (courseName) {
    const catalogId = resolveCatalogId(courses, dept.id, courseName);
    const assigned = managerEffectiveYears(dept, departments, catalogId);
    return assigned.length > 0 ? [...assigned].sort((a, b) => a - b) : fallbackYears;
  }

  const effectiveId = dept.parentDepartmentId ?? dept.id;
  const catalogIds = Array.from(new Set(
    courses.filter((c) => c.departmentId === effectiveId).map((c) => c.catalogId).filter((c): c is string => !!c)
  ));
  if (catalogIds.length === 0) {
    // No catalog-scoped course at all (a legacy, pre-catalog department) -
    // fall back to the flat-field-only resolution, unchanged from before.
    const assigned = managerEffectiveYears(dept, departments, undefined);
    return assigned.length > 0 ? [...assigned].sort((a, b) => a - b) : fallbackYears;
  }
  const union = new Set<number>();
  for (const catalogId of catalogIds) {
    for (const y of managerEffectiveYears(dept, departments, catalogId)) union.add(y);
  }
  return union.size > 0 ? Array.from(union).sort((a, b) => a - b) : fallbackYears;
}

/**
 * The years a course can register a student into before any department has
 * been chosen yet - capped at the course's own Years Taught duration (set by
 * the Principal when the course was created, Course.durationYears). Once a
 * department IS chosen, yearOptionsForDepartment above already respects this
 * same ceiling (a department can never be configured with a year beyond its
 * course's duration - see courses/route.ts POST/PATCH's own validation), so
 * this is only needed for the gap where a course is picked but its
 * department isn't (or isn't known) yet - e.g. the Students list's Course
 * filter with "All departments" still selected. A course can be offered by
 * more than one department (each with its own Course doc for the same
 * programme name); the longest of their durations is used as the cap, so
 * this never excludes a year some department genuinely offers - the
 * department-specific narrowing above still applies once one is picked.
 * Falls back to every college-configured year when the course name is blank
 * or unrecognised, matching yearOptionsForDepartment's own fallback shape.
 */
export function yearOptionsForCourse(courses: Course[], courseName: string | undefined, fallbackYears: number[]): number[] {
  if (!courseName) return fallbackYears;
  const durations = courses
    .filter((c) => c.name === courseName)
    .map((c) => Number(c.durationYears) || 0)
    .filter((n) => n > 0);
  if (durations.length === 0) return fallbackYears;
  const maxDuration = Math.max(...durations);
  return fallbackYears.filter((y) => y <= maxDuration);
}

interface FormProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Full department records - the Department select's options, and the source
   *  for the Secondary Department rollup above. */
  departments: Department[];
  /** Distinct course names offered by the Course select. */
  courseNames: string[];
  /** Full course records (with catalogId) - resolves which per-course
   *  courseScopes override applies once both Department and Course are picked. */
  courses: Course[];
  /** Academic years offered by the Year select. */
  years: number[];
  /**
   * Rendered read-only with a note. Used for Roll No on Edit: it's a template
   * column the Office can set at intake, but correcting it afterwards belongs
   * to the department (see students/[id] PATCH).
   */
  readOnlyKeys?: string[];
}

function FieldInput({ field, values, onChange, departments, courseNames, courses, years, readOnlyKeys }: FormProps & { field: RosterField }) {
  const value = values[field.key] ?? "";
  const id = `roster-${field.key}`;
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (readOnlyKeys?.includes(field.key)) {
    // Year is stored/edited as a plain number ("2") - format it the same way
    // the Year select and the detail view do, so the read-only rendering
    // doesn't look like a different, unformatted field.
    const displayValue = field.key === "year" && value ? ordinalYear(Number(value)) : value;
    const caption = field.key === "rollNumber"
      ? "Set by the department once the student is sectioned."
      : "Set when the student was added - use Sectioning/Promotion to move them, not this form.";
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <Input id={id} value={displayValue} disabled readOnly />
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
    );
  }

  if (field.key === "course") {
    // Course is required and comes FIRST in the flow - Department and Year
    // (below) both stay empty/disabled until it's picked, so a student can
    // never be added/imported without one (see ROSTER_FIELDS' `required`
    // flag and the server-side checks in college/students POST and
    // import-excel that back this up). Once a department IS picked (e.g. via
    // the Fix Row dialog's best-effort pre-resolve of a failed row, which can
    // land a department before a still-unresolved course), only ITS OWN
    // programmes are offered - not every course name in the college.
    const currentDeptId = departments.find((d) => d.name === values.department)?.id;
    const options = values.department ? courseNamesForDepartment(courses, departments, currentDeptId) : courseNames;
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value || NONE}
          onValueChange={(v) => {
            const courseName = v === NONE ? "" : v;
            onChange(field.key, courseName);
            if (!courseName) {
              // Nothing downstream is valid without a course chosen - Department
              // and Year both gate on it (see their own field blocks below) and
              // must be cleared, not just hidden, so a previously-picked value
              // can't silently survive un-rendered.
              onChange("department", "");
              onChange("secondaryDepartment", "");
              onChange("year", "");
              return;
            }
            // An already-chosen department that turns out not to offer the
            // new course (reachable when Course is changed to something only
            // some OTHER department owns, before Department is touched again)
            // can't stay paired with it - carrying it over would silently
            // register the student into a programme that department doesn't
            // run. Mirrors the Department field clearing Course the other way.
            const deptStillOffersIt = !values.department
              || courseNamesForDepartment(courses, departments, currentDeptId).includes(courseName);
            const nextDepartment = deptStillOffersIt ? values.department : "";
            if (!deptStillOffersIt) {
              onChange("department", "");
              onChange("secondaryDepartment", "");
            }
            const allowedYears = nextDepartment
              ? yearOptionsForDepartment(departments, courses, nextDepartment, courseName, years)
              : yearOptionsForCourse(courses, courseName, years);
            if (values.year && !allowedYears.includes(Number(values.year))) onChange("year", "");
          }}
        >
          <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not specified</SelectItem>
            {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.key === "department") {
    // Course comes FIRST (it's required - see the Course field's own note):
    // Department has nothing valid to offer until one is picked - a
    // department is only ever chosen from among the ones that actually run
    // the chosen course - so it stays empty and disabled instead of
    // defaulting to "every department in the college".
    let options = values.course ? departmentsOfferingCourse(departments, courses, values.course) : [];
    // At a college that runs a shared/common first year, a 1st-year student
    // must land under one of its Basic Science (Freshman) departments, never
    // directly under a real branch - see freshmanLandingDepartmentNames's own
    // doc-comment. Narrowing the picker itself (rather than only rejecting on
    // submit) is what keeps this in sync with the Add Student form's own
    // behaviour, which the bulk importer's "fix failed row" dialog reuses
    // verbatim (RosterFormFields).
    const freshmanNames = freshmanLandingDepartmentNames(departments);
    if (values.year === "1" && freshmanNames.size > 0) {
      options = options.filter((d) => freshmanNames.has(d.name));
    }
    // A value already on the form (e.g. the Fix Row dialog's best-effort
    // pre-resolve of a failed row's raw Department text, done before Course
    // is even known) must still be visible even if it falls outside the
    // options above - otherwise it looks like the field silently forgot the
    // department that's actually still sitting in the form's own state. The
    // Select stays disabled below regardless, so this can't be used to pick
    // anything else without a valid course first.
    if (value && !options.some((d) => d.name === value)) {
      const current = departments.find((d) => d.name === value);
      if (current) options = [...options, current];
    }
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value}
          disabled={!values.course}
          onValueChange={(v) => {
            onChange(field.key, v);
            // The branch list is the new department's, so a choice made under
            // the old one can't carry over.
            onChange("secondaryDepartment", "");
            // Nor can a previously chosen course this department doesn't
            // actually offer (reachable the same way as above, the other
            // direction) - only AIDS owns a Master of Technology Course doc,
            // so moving off AIDS can't leave that course silently selected.
            const newDeptId = departments.find((d) => d.name === v)?.id;
            const courseStillOffered = !values.course || courseNamesForDepartment(courses, departments, newDeptId).includes(values.course);
            const nextCourse = courseStillOffered ? (values.course ?? "") : "";
            if (!courseStillOffered) onChange("course", "");
            // Nor can a previously chosen year, if the new department doesn't
            // teach it for the (possibly just-cleared) course (e.g. switching
            // to a shared-first-year grouping sub-department like
            // BS-CHEMISTRY, which only teaches Year 1).
            let allowedYears = yearOptionsForDepartment(departments, courses, v, nextCourse, years);
            // Nor Year 1 specifically, if `v` is a real branch at a college
            // that runs a shared first year - even if this department's own
            // (possibly stale) assignedYears still lists it.
            if (freshmanNames.size > 0 && !freshmanNames.has(v)) allowedYears = allowedYears.filter((y) => y !== 1);
            if (values.year && !allowedYears.includes(Number(values.year))) onChange("year", "");
          }}
        >
          <SelectTrigger><SelectValue placeholder={values.course ? "Select department" : "Select a course first"} /></SelectTrigger>
          <SelectContent>
            {options.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.key === "secondaryDepartment") {
    // Only shown once a department is chosen AND that department actually
    // feeds branches - an ordinary standalone department has none, and an
    // empty dropdown would just be a dead control.
    const branches = values.department
      ? secondaryDepartmentOptions(departments, courses, values.department, values.course ?? "")
      : [];
    if (branches.length === 0) return null;
    // Required (not just offered) once a 1st-year student is correctly
    // landed under a Basic Science (Freshman) department - without it they're
    // stuck unpromotable. Mirrors the same rule the server enforces on submit
    // (college/students POST and the bulk importer's unassigned rows).
    const isRequiredNow = values.year === "1" && values.department
      ? freshmanLandingDepartmentNames(departments).has(values.department)
      : false;
    return (
      <div className="space-y-2">
        <Label>{field.label}{isRequiredNow ? " *" : ""}</Label>
        <Select value={value || NONE} onValueChange={(v) => onChange(field.key, v === NONE ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not specified</SelectItem>
            {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {isRequiredNow
            ? "Required for a 1st Year student: the real branch they'll be promoted into."
            : "The branch this student is registered to and will be promoted into."}
        </p>
      </div>
    );
  }

  if (field.key === "year") {
    // Course comes FIRST (it's required - see the Course field's own note):
    // Year has nothing valid to offer until one is picked, same as
    // Department above. Once it is, scoped to the chosen department's own
    // "Years Taught" for that course once a department is ALSO picked;
    // before that, capped by just the course's own duration
    // (yearOptionsForCourse).
    let options = !values.course
      ? []
      : values.department
        ? yearOptionsForDepartment(departments, courses, values.department, values.course, years)
        : yearOptionsForCourse(courses, values.course, years);
    // Year 1 is never valid for a real branch once the college runs a shared
    // first year - even if that branch's own (possibly stale) assignedYears
    // still lists it - see freshmanLandingDepartmentNames's own doc-comment.
    const freshmanNames = freshmanLandingDepartmentNames(departments);
    if (values.department && freshmanNames.size > 0 && !freshmanNames.has(values.department)) {
      options = options.filter((y) => y !== 1);
    }
    // Keep a value already on the form visible even if it falls outside the
    // options above (e.g. the Fix Row dialog seeding Year from a failed
    // row's raw text before a course is even chosen) - same reasoning as the
    // Department field's own fallback above. Still disabled below without a
    // course, so this can't be used to pick anything else.
    if (value && !options.includes(Number(value))) {
      options = [...options, Number(value)].sort((a, b) => a - b);
    }
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value}
          disabled={!values.course}
          onValueChange={(v) => {
            onChange(field.key, v);
            // The department picked before Year 1 was chosen may itself be a
            // real branch, invalid now that Year 1 is selected - clear it
            // (and whatever Core Department went with it) rather than leave
            // an invalid pairing the submit will just reject.
            if (v === "1" && values.department && freshmanNames.size > 0 && !freshmanNames.has(values.department)) {
              onChange("department", "");
              onChange("secondaryDepartment", "");
            }
          }}
        >
          <SelectTrigger><SelectValue placeholder={values.course ? "Select year" : "Select a course first"} /></SelectTrigger>
          <SelectContent>
            {options.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.kind === "select" || field.kind === "yesno") {
    const options = field.kind === "yesno" ? ["Yes", "No"] : field.options ?? [];
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value || NONE}
          onValueChange={(v) => onChange(field.key, v === NONE ? "" : v)}
        >
          <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not specified</SelectItem>
            {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
      />
    </div>
  );
}

/** Every stored roster field, in template order, identity block first. */
export function RosterFormFields(props: FormProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Identity</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PRIMARY_ROSTER_FIELDS.map((f) => (
            <FieldInput key={f.key} field={f} {...props} />
          ))}
        </div>
      </div>
      <div className="border-t pt-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Admission Details</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DETAIL_ROSTER_FIELDS.map((f) => (
            <FieldInput key={f.key} field={f} {...props} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ViewRow({ field, student }: { field: RosterField; student: Partial<StudentRecord> }) {
  const value = rosterFieldDisplay(field, student);
  return (
    <div>
      <p className="text-xs text-muted-foreground">{field.label}</p>
      <p className="text-sm font-medium break-words">
        {value || <span className="text-muted-foreground/50">—</span>}
      </p>
    </div>
  );
}

/**
 * Read-only view of a student: the identity fields first, then the rest of the
 * admission detail, both in the CSV template's order.
 */
export function RosterDetailView({ student }: { student: Partial<StudentRecord> }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Identity</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 rounded-lg border bg-muted/20 p-3">
          {PRIMARY_ROSTER_FIELDS.map((f) => <ViewRow key={f.key} field={f} student={student} />)}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Admission Details</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 rounded-lg border p-3">
          {DETAIL_ROSTER_FIELDS.map((f) => <ViewRow key={f.key} field={f} student={student} />)}
        </div>
      </div>
    </div>
  );
}

export { EDITABLE_ROSTER_FIELDS };
