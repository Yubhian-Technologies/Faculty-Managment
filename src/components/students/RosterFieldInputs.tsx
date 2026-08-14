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
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
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
 * The catalog course a department's own Course doc resolves `courseName` to -
 * needed to look up that course's per-course override in
 * Department.courseScopes (resolveDepartmentCourseScope). Prefers the
 * department's own Course doc; falls back to any other department's Course
 * doc with the same name (a department that inherits a course through a
 * common first-year feeder, rather than owning it directly, has none of its
 * own) - safe because the course catalog itself prevents two entries sharing
 * a name, so any Course doc named "Master of Technology" always points to the
 * same catalog id.
 */
function resolveCatalogId(courses: Course[], departmentId: string | undefined, courseName: string): string | undefined {
  if (!courseName) return undefined;
  return (
    courses.find((c) => c.departmentId === departmentId && c.name === courseName)
    ?? courses.find((c) => c.name === courseName)
  )?.catalogId;
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
export function courseNamesForDepartment(courses: Course[], departmentId: string | undefined): string[] {
  if (!departmentId) return [];
  return Array.from(new Set(
    courses.filter((c) => c.departmentId === departmentId).map((c) => c.name?.trim()).filter(Boolean) as string[]
  )).sort((a, b) => a.localeCompare(b));
}

/**
 * The reverse of courseNamesForDepartment: departments that actually own a
 * Course doc named `courseName`. Keeps the Department picker from offering a
 * department that never had `courseName` added to it once a course is picked
 * first - the other half of the same constraint.
 */
export function departmentsOfferingCourse(departments: Department[], courses: Course[], courseName: string): Department[] {
  const deptIds = new Set(courses.filter((c) => c.name === courseName).map((c) => c.departmentId));
  return departments.filter((d) => deptIds.has(d.id));
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
 * student under BS-CHEMISTRY again). Falls back to every college-configured
 * year when the department has neither, so an unconfigured department isn't
 * locked out entirely.
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
  const catalogId = resolveCatalogId(courses, dept.id, courseName);
  const assigned = resolveDepartmentCourseScope(dept, catalogId).assignedYears;
  return assigned.length > 0 ? [...assigned].sort((a, b) => a - b) : fallbackYears;
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
    // Once a department is chosen, only ITS OWN programmes are offered - not
    // every course name in the college - so a department that was never given
    // a Master of Technology can't be paired with one. Unfiltered (every
    // course name college-wide) until a department is picked, same "don't
    // block a field before the other is chosen" rule the Year field uses.
    const currentDeptId = departments.find((d) => d.name === values.department)?.id;
    const options = values.department ? courseNamesForDepartment(courses, currentDeptId) : courseNames;
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value || NONE}
          onValueChange={(v) => {
            const courseName = v === NONE ? "" : v;
            onChange(field.key, courseName);
            // An already-chosen department that turns out not to offer the
            // new course (reachable when Course is changed to something only
            // some OTHER department owns, before Department is touched again)
            // can't stay paired with it - carrying it over would silently
            // register the student into a programme that department doesn't
            // run. Mirrors the Department field clearing Course the other way.
            const deptStillOffersIt = !courseName || !values.department
              || courseNamesForDepartment(courses, currentDeptId).includes(courseName);
            const nextDepartment = deptStillOffersIt ? values.department : "";
            if (!deptStillOffersIt) {
              onChange("department", "");
              onChange("secondaryDepartment", "");
            }
            const allowedYears = nextDepartment
              ? yearOptionsForDepartment(departments, courses, nextDepartment, courseName, years)
              : years;
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
    // Symmetric with the Course field above: once a course is chosen, only
    // the department(s) actually offering it are selectable - e.g. Master of
    // Technology narrows this to just the department(s) the Principal added
    // it to, so a college-wide "any department" picker never suggests a pairing
    // that doesn't exist as a real Course doc.
    const options = values.course ? departmentsOfferingCourse(departments, courses, values.course) : departments;
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={value}
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
            const courseStillOffered = !values.course || courseNamesForDepartment(courses, newDeptId).includes(values.course);
            const nextCourse = courseStillOffered ? (values.course ?? "") : "";
            if (!courseStillOffered) onChange("course", "");
            // Nor can a previously chosen year, if the new department doesn't
            // teach it for the (possibly just-cleared) course (e.g. switching
            // to a shared-first-year grouping sub-department like
            // BS-CHEMISTRY, which only teaches Year 1).
            const allowedYears = yearOptionsForDepartment(departments, courses, v, nextCourse, years);
            if (values.year && !allowedYears.includes(Number(values.year))) onChange("year", "");
          }}
        >
          <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
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
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value || NONE} onValueChange={(v) => onChange(field.key, v === NONE ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not specified</SelectItem>
            {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The branch this student is registered to and will be promoted into.
        </p>
      </div>
    );
  }

  if (field.key === "year") {
    // Scoped to the chosen department's own "Years Taught" for the chosen
    // course once a department is picked - otherwise every college-configured
    // year, so the field isn't blocked before a department is even chosen.
    const options = values.department
      ? yearOptionsForDepartment(departments, courses, values.department, values.course ?? "", years)
      : years;
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value} onValueChange={(v) => onChange(field.key, v)}>
          <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
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
