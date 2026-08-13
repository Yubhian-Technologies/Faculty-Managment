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
import type { StudentRecord } from "@/types";

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

interface FormProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Department names offered by the Department select. */
  departments: { id: string; name: string }[];
  /** Academic years offered by the Year select. */
  years: number[];
  /**
   * Rendered read-only with a note. Used for Roll No on Edit: it's a template
   * column the Office can set at intake, but correcting it afterwards belongs
   * to the department (see students/[id] PATCH).
   */
  readOnlyKeys?: string[];
}

function FieldInput({ field, values, onChange, departments, years, readOnlyKeys }: FormProps & { field: RosterField }) {
  const value = values[field.key] ?? "";
  const id = `roster-${field.key}`;
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (readOnlyKeys?.includes(field.key)) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <Input id={id} value={value} disabled readOnly />
        <p className="text-xs text-muted-foreground">Set by the department once the student is sectioned.</p>
      </div>
    );
  }

  if (field.key === "department") {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value} onValueChange={(v) => onChange(field.key, v)}>
          <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
          <SelectContent>
            {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.key === "year") {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value} onValueChange={(v) => onChange(field.key, v)}>
          <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
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
