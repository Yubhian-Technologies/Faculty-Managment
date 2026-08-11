"use client";

import {
  Select, SelectContent, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel, SelectItem, SelectSeparator,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getTeachingDesignations, getSupportingDesignations, designationLabel } from "@/lib/designations/config";
import type { CollegeType } from "@/types";

type DesignationKind = "teaching" | "supporting" | "both";

interface Props {
  collegeType: CollegeType | undefined;
  // Faculty (FacultyMember) is teaching-only; Supporting Staff is supporting-
  // only; Salary Structures cover both under one designation picker.
  kind?: DesignationKind;
}

// Shared designation option list, sourced from the per-college-type
// catalogues in src/lib/designations/config.ts (Faculty add/edit, Supporting
// Staff add/edit, Salary Structures) - keeps Teaching and Supporting
// designations visually grouped and labeled rather than one undifferentiated
// list. Always ends with a free-text "Other" escape hatch.
export function DesignationOptions({ collegeType, kind = "both" }: Props) {
  const teaching = kind !== "supporting" ? getTeachingDesignations(collegeType) : [];
  const supporting = kind !== "teaching" ? getSupportingDesignations(collegeType) : [];
  return (
    <>
      {teaching.length > 0 && (
        <SelectGroup>
          <SelectLabel>Teaching</SelectLabel>
          {teaching.map((v) => (
            <SelectItem key={v} value={v}>{designationLabel(v)}</SelectItem>
          ))}
        </SelectGroup>
      )}
      {teaching.length > 0 && supporting.length > 0 && <SelectSeparator />}
      {supporting.length > 0 && (
        <SelectGroup>
          <SelectLabel>Supporting</SelectLabel>
          {supporting.map((v) => (
            <SelectItem key={v} value={v}>{designationLabel(v)}</SelectItem>
          ))}
        </SelectGroup>
      )}
      <SelectSeparator />
      <SelectItem value="OTHER">Other</SelectItem>
    </>
  );
}

// A complete designation field - label + dropdown + "Other" free-text escape
// hatch - for the places that record a designation outside the Faculty/
// Supporting Staff add forms (currently Promotion History's From/To, which
// used to be plain text boxes).
//
// Two things force the fallback: promotion records written before this picker
// existed hold arbitrary free text, and the catalogue itself varies by college
// type, so a value valid at one college won't appear in another's list.
// Rather than silently dropping such a value, anything the current catalogue
// doesn't contain selects "Other" and keeps the original text in the input
// beside it - the same pattern DegreeFields uses for Course.
export function DesignationSelect({
  label, value, onChange, collegeType, kind = "both",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  collegeType: CollegeType | undefined;
  kind?: DesignationKind;
}) {
  const known = [
    ...(kind !== "supporting" ? getTeachingDesignations(collegeType) : []),
    ...(kind !== "teaching" ? getSupportingDesignations(collegeType) : []),
  ];
  const isOther = !!value && !known.includes(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={isOther ? "OTHER" : (value ?? "")} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
        <SelectContent><DesignationOptions collegeType={collegeType} kind={kind} /></SelectContent>
      </Select>
      {isOther && (
        <Input
          value={value === "OTHER" ? "" : value}
          onChange={(e) => onChange(e.target.value || "OTHER")}
          placeholder="Please specify"
        />
      )}
    </div>
  );
}
