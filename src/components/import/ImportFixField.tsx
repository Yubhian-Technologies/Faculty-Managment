"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getTeachingDesignations, getHodTechnicalDesignations, getNonTechnicalDesignations, designationLabel,
} from "@/lib/designations/config";
import {
  matchOption,
  GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, RATIFICATION_STATUS_OPTIONS, RELIGION_OPTIONS, CASTE_OPTIONS, BLOOD_GROUP_OPTIONS,
} from "@/lib/import/fieldConstraints";
import { EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { CollegeType } from "@/types";

// Which designation catalogue a "Fix Row" dialog's Designation field should
// offer - matches the same kind the manual Add form for that module uses
// (DesignationOptions.tsx): "teaching" for Faculty, "supporting" for HOD's
// (Technical) Supporting Staff, "non-technical" for College Office's
// Non-Technical Staff.
export type ImportDesignationKind = "teaching" | "supporting" | "non-technical";

const STATUS_KEYS = ["ACTIVE", "ON_LEAVE", "RESIGNED", "RETIRED"] as const;
// Columns whose template guidance states a plain Yes/No answer.
const YES_NO_KEYS = new Set(["differentlyAbled", "permanentSameAsTemporary", "aicteEligible", "hasPHD"]);

// The fixed option list a column's Select should offer, sourced from exactly
// the same catalogues the single "Add Faculty/Staff" form's own dropdowns use
// (src/lib/designations/config.ts) and the same option sets the import route
// itself validates against (src/lib/import/fieldConstraints.ts) - so a value
// picked here can never fail the row for not matching what's allowed.
// `undefined` means the column has no fixed set and stays a plain text Input.
function fixFieldOptions(
  fieldKey: string,
  collegeType: CollegeType | undefined,
  designationKind: ImportDesignationKind,
  departmentOptions: string[] | undefined,
): string[] | undefined {
  switch (fieldKey) {
    case "designation": {
      const codes = designationKind === "teaching" ? getTeachingDesignations(collegeType)
        : designationKind === "supporting" ? getHodTechnicalDesignations(collegeType)
        : getNonTechnicalDesignations(collegeType);
      return [...codes.map((c) => designationLabel(c)), "Other"];
    }
    case "employmentType":
      return Object.values(EMPLOYMENT_TYPE_LABELS);
    case "status":
      return STATUS_KEYS.map((s) => FACULTY_STATUS_LABELS[s]);
    case "gender":
      return [...GENDER_OPTIONS];
    case "maritalStatus":
      return [...MARITAL_STATUS_OPTIONS];
    case "ratificationStatus":
      return [...RATIFICATION_STATUS_OPTIONS];
    case "religion":
      return [...RELIGION_OPTIONS];
    case "caste":
      return [...CASTE_OPTIONS];
    case "bloodGroup":
      return [...BLOOD_GROUP_OPTIONS];
    case "department":
      return departmentOptions;
    default:
      return YES_NO_KEYS.has(fieldKey) ? ["Yes", "No"] : undefined;
  }
}

interface Props {
  fieldKey: string;
  label: string;
  required: boolean;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  collegeType: CollegeType | undefined;
  designationKind: ImportDesignationKind;
  // Only Non-Technical Staff's Fix dialog passes this (College Office's own
  // "Add Staff" form is the only one of the three with a Department picker -
  // Faculty has no Department column at all, and HOD's Supporting Staff
  // defaults it automatically with no picker either - see the manual add
  // pages this mirrors).
  departmentOptions?: string[];
}

// One "Fix Row" dialog field: a dropdown wherever the import template states
// a fixed set of options - Designation, Employment Type, Status, Gender,
// Marital Status, Ratification Status, Religion, Caste, Blood Group, and any
// plain Yes/No column - so correcting a rejected value is a pick from the
// same list the Add/Edit form itself offers, not a guess at exact spelling.
// Falls through to a plain text Input for every other column, unchanged from
// before.
export function ImportFixField({
  fieldKey, label, required, value, placeholder, onChange, collegeType, designationKind, departmentOptions,
}: Props) {
  const options = fixFieldOptions(fieldKey, collegeType, designationKind, departmentOptions);

  if (!options) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`fix-${fieldKey}`}>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
        <Input
          id={`fix-${fieldKey}`}
          type={fieldKey === "password" ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }

  // The row's original value is whatever text failed import - matched back
  // to one of this field's known options the same case/punctuation-tolerant
  // way the import route itself matches it, so a near-exact value (e.g.
  // "regular" for Employment Type) still shows pre-selected instead of
  // blank. A value with no match (an abbreviation, a typo, an off-catalogue
  // title) leaves the dropdown unselected - the row's error message above
  // already says what was wrong, and any pick here is guaranteed valid.
  const selected = matchOption(value, options);

  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      <Select value={selected ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={`Select ${label.replace(/\s*\(.*\)/, "").toLowerCase()}`} /></SelectTrigger>
        <SelectContent>
          {options.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
